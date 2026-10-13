// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service;

import com.checkba.model.dto.SearchRequest;
import com.checkba.model.entity.*;
import com.checkba.repository.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ContentSearchClientAccessTest {
 @Test void globalClientSearchExtractsOnlyExplicitlyReadableFiles() throws Exception {
  var files=mock(ProjectFileRepository.class); var members=mock(ProjectMemberService.class);var users=mock(UserRepository.class);
  User user=new User();user.setId(9L);user.setRole("CLIENT");when(users.findById(9L)).thenReturn(Optional.of(user));
  when(members.hasReadPermission(1L,9L)).thenReturn(true);when(members.isClient(1L,9L)).thenReturn(false);
  ProjectFile hidden=file(1L,false),visible=file(2L,true);
  when(files.findByProjectIdAndIsDeletedFalseOrderBySortOrderAsc(1L)).thenReturn(List.of(hidden,visible));
  var text=mock(DocumentTextService.class);when(text.extractPlainText(visible)).thenReturn("公开材料中的合同");
  var service=new ContentSearchService(files,mock(FileTagRepository.class),mock(TagRepository.class),text,null,
    new ProjectFileAccessService(members,users,files));
  SearchRequest request=new SearchRequest();request.setQuery("合同");
  try {
   var result=service.searchContent(1L,request,9L);
   assertEquals(1,result.getTotalFiles());assertEquals(2L,result.getResults().get(0).getFileId());
   verify(text,never()).extractPlainText(hidden);verify(text).extractPlainText(visible);
   visible.setClientVisible(false);
   assertEquals(0,service.searchContent(1L,request,9L).getTotalFiles());
   verify(text,times(1)).extractPlainText(visible);
   assertThrows(IllegalArgumentException.class,()->service.searchContent(1L,request));
  } finally {service.shutdown();}
 }
 private ProjectFile file(Long id,boolean visible) {
  var f=new ProjectFile();f.setId(id);f.setProjectId(1L);f.setUserId(2L);f.setName("材料"+id+".txt");
  f.setFilePath("synthetic/"+id+".txt");f.setFileType("txt");f.setIsDeleted(false);f.setIsFolder(false);f.setClientVisible(visible);return f;
 }
}
