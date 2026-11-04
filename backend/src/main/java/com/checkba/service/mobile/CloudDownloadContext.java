// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;
import org.springframework.web.context.request.*;
/** Resource identity is written only after the controller's authoritative ownership check. */
public record CloudDownloadContext(Long userId,String resourceId) {
 private static final String KEY=CloudDownloadContext.class.getName();
 public static void mark(Long userId,String resourceId) {
  if(userId==null || resourceId==null || resourceId.isBlank()) throw new IllegalArgumentException("Missing authorized resource identity");
  if(RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes)
   attributes.getRequest().setAttribute(KEY,new CloudDownloadContext(userId,resourceId));
 }
 public static CloudDownloadContext from(jakarta.servlet.http.HttpServletRequest request) {
  return request.getAttribute(KEY) instanceof CloudDownloadContext context?context:null;
 }
}
