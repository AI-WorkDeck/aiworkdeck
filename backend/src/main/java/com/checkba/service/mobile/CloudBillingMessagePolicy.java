// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import com.checkba.service.messagecenter.MessageCenterAccessPolicy;
import org.springframework.stereotype.Component;
@Component
public class CloudBillingMessagePolicy implements MessageCenterAccessPolicy {
 public String sourceId() { return "cloud-billing"; }
 public boolean canAccess(Long user,String event) { return user!=null && event!=null && event.startsWith("billing:"+user+":"); }
}
