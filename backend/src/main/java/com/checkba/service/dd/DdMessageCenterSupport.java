// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.dd;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Map;

/** Compatibility with old DD hosts: unknown time zone means unknown time, not an invented local instant. */
final class DdMessageCenterSupport {
    private static final ObjectMapper JSON=new ObjectMapper();
    private DdMessageCenterSupport() {}
    static Instant instant(Map<String,Object> row,String field) {
        Instant withOffset=parse(row.get(field+"Iso"));
        return withOffset!=null?withOffset:parse(row.get(field));
    }
    private static Instant parse(Object value) {
        if (value==null) return null;
        try { return Instant.parse(value.toString()); }
        catch (java.time.format.DateTimeParseException ignored) {
            try { return OffsetDateTime.parse(value.toString()).toInstant(); }
            catch (java.time.format.DateTimeParseException unknownZone) { return null; }
        }
    }
    static boolean read(Map<String,Object> row) {
        return present(row.get("readAt")) || present(row.get("readAtIso"));
    }
    private static boolean present(Object value) { return value!=null && !String.valueOf(value).isBlank(); }
    static void requireReadReceipt(int status,byte[] body,String id) {
        if (status!=200 || body==null || body.length>65536) throw unconfirmed();
        try {
            Map<String,Object> row=JSON.readValue(body,new TypeReference<>(){});
            if (row==null || (row.containsKey("code") && (!(row.get("code") instanceof Number code) || code.intValue()!=0))) throw unconfirmed();
            if (row.get("data") instanceof Map<?,?> data) row=JSON.convertValue(data,new TypeReference<>(){});
            if (!id.equals(String.valueOf(row.get("id"))) || !read(row)) throw unconfirmed();
        } catch (java.io.IOException e) { throw unconfirmed(); }
    }
    private static IllegalArgumentException unconfirmed() { return new IllegalArgumentException(com.checkba.service.LangText.of("通知已读状态未确认，请稍后重试", "Notification read status was not confirmed; please try again later")); }
}
