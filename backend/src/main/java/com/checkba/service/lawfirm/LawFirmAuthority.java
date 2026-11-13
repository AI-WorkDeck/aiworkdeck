// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;

import com.checkba.repository.AccountBindingRepository;
import com.checkba.service.LangText;
import com.checkba.service.collab.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import java.util.HashMap;
import java.util.Map;
import java.util.Collection;
import java.util.Objects;
import java.util.Set;

/** Identity comes from the account directory, never from names, local-mode or memory write permission. */
@Service
@RequiredArgsConstructor
public class LawFirmAuthority {
    private final AccountBindingRepository bindings;
    private final AccountDirectoryClient directory;
    private static final String REQUEST_DIRECTORY = LawFirmAuthority.class.getName() + ".directory";
    private record DirectoryKey(String requester, String candidate) {}
    public record Member(Long userId, String accountId, String firmId, String name, boolean firmAdmin) {}

    public Member current(Long userId) {
        String account = account(userId);
        DirectoryReply reply = directoryReply(account, account);
        return member(userId, reply, reply.candidate());
    }

    public Member requireMember(Long requester, Long target) {
        String me = account(requester);
        DirectoryReply reply = directoryReply(me, account(target));
        if (reply.requester() == null || reply.candidate() == null || reply.requester().firmId() == null
                || !Objects.equals(reply.requester().firmId(), reply.candidate().firmId())) throw denied();
        return member(target, reply, reply.candidate());
    }

    public Member lookup(Long requester, String identifier) {
        if (identifier == null || identifier.isBlank() || identifier.length() > 254) throw new IllegalArgumentException(LangText.of("请输入同事的账户手机号或邮箱", "Please enter the colleague's account phone number or email"));
        DirectoryReply reply = directory.lookupByIdentifier(account(requester), identifier.trim());
        if (!reply.found() || reply.account() == null || reply.requester() == null || reply.candidate() == null || reply.requester().firmId() == null
                || !Objects.equals(reply.requester().firmId(), reply.candidate().firmId())) throw denied();
        Long userId = bindings.findByExternalAccountId(reply.account().accountId())
                .orElseThrow(() -> new IllegalArgumentException(LangText.of("该同事尚未连接官方案件库，请对方先在桌面端连接账户后重试", "This colleague has not connected to the official case library yet; please ask them to connect their account on desktop first"))).getUserId();
        return member(userId, reply, reply.candidate());
    }

    /**
     * Directory facts about one account as seen by a same-firm requester: firm, ALL teams and firm-admin role.
     * The directory reports one team per account today; callers must still treat teams as a set.
     */
    public record Scope(Long userId, String firmId, Set<String> teamIds, boolean firmAdmin) {
        public Scope { teamIds = teamIds == null ? Set.of() : Set.copyOf(teamIds); }
        public boolean inFirm(String firm) { return firmId != null && firmId.equals(firm); }
        public boolean inTeam(String team) { return team != null && teamIds.contains(team); }
        /** True when this account shares at least one team with {@code teams}. */
        public boolean sharesTeam(Collection<String> teams) { return teams != null && teams.stream().anyMatch(teamIds::contains); }
    }

    private static Set<String> teams(OrgMembership m) {
        return m == null || m.teamId() == null ? Set.of() : Set.of(m.teamId());
    }

    /**
     * Team/firm scope of {@code target} for visibility checks by cloud features (e.g. team-wide sharing).
     * Throws {@link AccessDenied} unless requester and target are in the same firm per the directory.
     */
    public Scope scope(Long requester, Long target) {
        String me = account(requester);
        DirectoryReply reply = directoryReply(me, account(target));
        if (!reply.found() || reply.requester() == null || reply.candidate() == null || reply.requester().firmId() == null
                || !Objects.equals(reply.requester().firmId(), reply.candidate().firmId())) throw denied();
        return new Scope(target, reply.candidate().firmId(), teams(reply.candidate()), reply.candidate().firmAdmin());
    }

    /** The requester's own team and firm per the directory. */
    public Scope scope(Long userId) {
        String me = account(userId);
        DirectoryReply reply = directoryReply(me, me);
        if (!reply.found() || reply.candidate() == null || reply.candidate().firmId() == null) throw denied();
        return new Scope(userId, reply.candidate().firmId(), teams(reply.candidate()), reply.candidate().firmAdmin());
    }

    /** Reuse only within this HTTP request; every later list/read/decision rechecks the directory. */
    @SuppressWarnings("unchecked")
    private DirectoryReply directoryReply(String requester, String candidate) {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        if (request == null) return directory.lookupByAccountId(requester, candidate);
        Map<DirectoryKey, DirectoryReply> replies = (Map<DirectoryKey, DirectoryReply>) request.getAttribute(REQUEST_DIRECTORY, RequestAttributes.SCOPE_REQUEST);
        if (replies == null) {
            replies = new HashMap<>();
            request.setAttribute(REQUEST_DIRECTORY, replies, RequestAttributes.SCOPE_REQUEST);
        }
        return replies.computeIfAbsent(new DirectoryKey(requester, candidate), key -> directory.lookupByAccountId(key.requester(), key.candidate()));
    }

    private String account(Long userId) {
        if (userId == null) throw denied();
        if (!directory.configured()) throw new DirectoryUnavailableException(LangText.of("律所账户名录暂不可用，请稍后重试", "Law firm account directory is temporarily unavailable; please try again later"));
        return bindings.findByUserId(userId).orElseThrow(LawFirmAuthority::denied).getExternalAccountId();
    }
    private Member member(Long userId, DirectoryReply reply, OrgMembership membership) {
        if (!reply.found() || reply.account() == null || membership == null || membership.firmId() == null) throw denied();
        return new Member(userId, reply.account().accountId(), membership.firmId(), reply.account().displayName(), membership.firmAdmin());
    }
    static AccessDenied denied() { return new AccessDenied(); }
    static final class AccessDenied extends IllegalArgumentException {
        private AccessDenied() { super(LangText.of("当前账户无权访问该律所协作记录，或对方不属于同一律所", "Current account is not authorized to access this law firm record, or the other party is not in the same law firm")); }
    }
}
