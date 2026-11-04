// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.version.cloud;

import com.checkba.repository.ProjectRepository;
import com.checkba.repository.UserRepository;
import com.checkba.service.mobile.CloudStorageQuotaService;
import com.checkba.service.mobile.MobileBillingService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.Map;
import java.util.Objects;

/** Caller holds the repository lock; the account lock serializes publication with cloud cleanup. */
@Service
public class CloudGitWriteGuard {
 private final ProjectRepository projects;private final UserRepository users;
 private final CloudStorageQuotaService quota;private final MobileBillingService billing;
 private final TransactionTemplate tx;
 public CloudGitWriteGuard(ProjectRepository projects,UserRepository users,CloudStorageQuotaService quota,
        MobileBillingService billing,PlatformTransactionManager manager) {
  this.projects=projects;this.users=users;this.quota=quota;this.billing=billing;this.tx=new TransactionTemplate(manager);
 }
 public boolean enabled(){return quota.isEnabled()&&quota.postpaidEnabled();}
 private Long owner(Long projectId,Long personalOwner) {
  if(projectId==null)return Objects.requireNonNull(personalOwner);
  var project=projects.findById(projectId).orElseThrow(()->new GitAccessDeniedException(404));
  if(!Objects.equals(project.getUserId(),project.getCloudBillingOwnerId()) || project.getCloudBillingOwnerId()==null
      || !"PERSONAL".equals(project.getCloudOwnership()) || (project.getLocalRoot()!=null&&!project.getLocalRoot().isBlank()))
   throw new GitAccessDeniedException(403);
  return project.getCloudBillingOwnerId();
 }
 public Map<String,Object> state(Long projectId,Long personalOwner) {
  if(!enabled())return Map.of("cloudAccess",Map.of("epoch",0,"canWrite",true));
  var access=(Map<?,?>)billing.cloudState(owner(projectId,personalOwner)).get("cloudAccess");
  return Map.of("cloudAccess",Map.of("epoch",access.get("epoch"),"canWrite",Boolean.TRUE.equals(access.get("canWrite"))));
 }
 public void write(Long projectId,Long personalOwner,Runnable operation) {
  if(!enabled()){operation.run();return;}
  tx.executeWithoutResult(status->{
   Long owner=owner(projectId,personalOwner);users.lockStorageOwner(owner).orElseThrow(()->new GitAccessDeniedException(403));
   // A locking query observes deletion after waiting, unlike a cached findById entity.
   if(projectId!=null) {
    var locked=projects.lockForImWrite(projectId).orElseThrow(()->new GitAccessDeniedException(404));
    if(!Objects.equals(owner,locked.getCloudBillingOwnerId()))throw new GitAccessDeniedException(403);
   }
   quota.requireCloudWrite(owner);quota.storageChanging(owner);operation.run();
  });
 }
}
