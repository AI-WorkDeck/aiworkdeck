// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;
import com.checkba.service.messagecenter.MessageCenterAccessPolicy;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
@Component
public class LawFirmMessageAccessPolicy implements MessageCenterAccessPolicy {
    private final ObjectProvider<LawFirmWorkflowService> workflows;
    public LawFirmMessageAccessPolicy(ObjectProvider<LawFirmWorkflowService> workflows){this.workflows=workflows;}
    @Override public String sourceId(){return "lawfirm";}
    @Override public boolean canAccess(Long userId,String eventKey){return workflows.getObject().canAccess(userId,eventKey);}
}
