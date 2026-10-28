// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;
import com.checkba.service.ai.OfficeBridgeService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import com.checkba.model.entity.ProjectFile;
import com.checkba.repository.ProjectFileRepository;
import com.checkba.service.ai.context.ProjectContextHolder;
import com.checkba.storage.StorageService;
import com.checkba.storage.StorageServiceFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.InputStreamResource;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
class OfficePptMediaTest {
    final OfficeBridgeService bridge=mock(OfficeBridgeService.class);
    final OfficeEditTools tools=new OfficeEditTools(bridge,new ObjectMapper(),null,null,null,null,null);
    @Test void mediaErrorsHaveTwentyNonemptyTranslations(){
        var messages=OfficeToolMessages.MESSAGES.get("mediaArgumentsInvalid");
        assertEquals(20,messages.size());assertTrue(messages.values().stream().allMatch(v->v!=null&&!v.isBlank()));
    }
    @Test void chartRejectsInvalidDataBeforeDispatch(){
        assertTrue(tools.office_ppt_add_chart("c",1,"pie","[\"A\"]","[{\"name\":\"s\",\"values\":[-1]}]",0.,0.,100.,100.,null).startsWith("Error:"));
        assertTrue(tools.office_ppt_add_chart("c",1,"line","[\"A\"]","[{\"name\":\"s\",\"values\":[1,2]}]",0.,0.,100.,100.,null).startsWith("Error:"));
        assertTrue(tools.office_ppt_add_chart("c",1,"scatter","[\"A\"]","[{\"name\":\"s\",\"values\":[1]}]",0.,0.,100.,100.,null).startsWith("Error:"));
        verifyNoInteractions(bridge);
    }
    @Test void chartKeepsNativeSeriesContract(){
        tools.office_ppt_add_chart("c",1,"column","[\"A\"]","[{\"name\":\"s\",\"values\":[2]}]",-10.,0.,100.,100.,"T");
        verify(bridge).executeOfficeCommand(eq("c"),eq("ppt_add_chart"),argThat(a->a.get("chartType").equals("column")&&a.get("left").equals(-10.)&&a.containsKey("series")));
    }
    @Test void styleAndTransitionRejectBeforeDispatch(){
        assertTrue(tools.office_ppt_format_chart("c",1,"x",null,null,null,null,null,null).startsWith("Error:"));
        assertTrue(tools.office_ppt_format_chart("c",1,"x","red",null,null,null,null,null).startsWith("Error:"));
        assertTrue(tools.office_ppt_set_transition("c",1,"fade",Double.NaN).startsWith("Error:"));
        assertTrue(tools.office_ppt_add_image("c",1L,1,0.,0.,0.,100.,null,null,null,null).startsWith("Error:"));
        verifyNoInteractions(bridge);
    }
    @Test void transitionForwardsExactDurationWithoutAutoAdvance(){
        tools.office_ppt_set_transition("c",2,"push",0.4);
        verify(bridge).executeOfficeCommand(eq("c"),eq("ppt_set_transition"),argThat(a->a.get("durationSeconds").equals(.4)&&a.size()==3));
    }
    @AfterEach void clearContext(){ProjectContextHolder.clear();}
    final ProjectFileRepository files=mock(ProjectFileRepository.class);
    final StorageService storage=mock(StorageService.class);
    final StorageServiceFactory factory=mock(StorageServiceFactory.class);
    OfficeEditTools imageTools(){
        when(factory.getStorageService()).thenReturn(storage);
        return new OfficeEditTools(bridge,new ObjectMapper(),files,factory,null,null,null);
    }
    ProjectFile imageFile(){
        ProjectContextHolder.setProjectId("7");
        ProjectFile f=new ProjectFile();f.setId(1L);f.setProjectId(7L);f.setFilePath("synthetic.png");
        when(files.findById(1L)).thenReturn(Optional.of(f));return f;
    }
    String addImage(OfficeEditTools t){return t.office_ppt_add_image("c",1L,1,0.,0.,100.,100.,"contain",false,null,null);}
    @Test void sameProjectImageForwardsExactBytes(){
        imageFile();byte[] png={-119,80,78,71,13,10,26,10};
        when(storage.load("synthetic.png")).thenReturn(new ByteArrayResource(png));
        addImage(imageTools());
        verify(bridge).executeOfficeCommand(eq("c"),eq("ppt_add_image"),argThat(a->
            java.util.Base64.getEncoder().encodeToString(png).equals(a.get("base64"))&&"contain".equals(a.get("fit"))));
    }
    @Test void inaccessibleImagesNeverReadStorageOrDispatch(){
        var t=imageTools();var f=imageFile();
        f.setProjectId(8L);assertTrue(addImage(t).startsWith("Error:"));
        f.setProjectId(7L);f.setIsDeleted(true);assertTrue(addImage(t).startsWith("Error:"));
        f.setIsDeleted(false);f.setIsFolder(true);assertTrue(addImage(t).startsWith("Error:"));
        f.setIsFolder(false);ProjectContextHolder.clear();assertTrue(addImage(t).startsWith("Error:"));
        when(files.findById(1L)).thenReturn(Optional.empty());assertTrue(addImage(t).startsWith("Error:"));
        verifyNoInteractions(storage,bridge);
    }
    @Test void oversizedImageReadsAtMostLimitPlusOneThenClosesWithoutDispatch(){
        imageFile();final int limit=12*1024*1024;
        class CountedStream extends java.io.InputStream {
            int consumed;boolean closed;
            public int read(){if(consumed>=limit+100)return -1;consumed++;return 0;}
            public int read(byte[] b,int off,int len){
                if(len==0)return 0;
                int n=Math.min(len,limit+100-consumed);if(n==0)return -1;
                java.util.Arrays.fill(b,off,off+n,(byte)0);consumed+=n;return n;
            }
            public void close(){closed=true;}
        }
        var input=new CountedStream();
        when(storage.load("synthetic.png")).thenReturn(new InputStreamResource(input));
        assertTrue(addImage(imageTools()).startsWith("Error:"));
        assertEquals(limit+1,input.consumed);assertTrue(input.closed);verifyNoInteractions(bridge);
    }

}
