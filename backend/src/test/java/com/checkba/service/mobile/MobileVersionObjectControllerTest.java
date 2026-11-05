// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.mobile;

import com.checkba.controller.AuthController;
import com.checkba.controller.MobileRelayController;
import com.checkba.exception.UnauthorizedException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MobileVersionObjectControllerTest {
    MobileVersionObjectService objects=mock(MobileVersionObjectService.class);
    MobileRelayController controller=new MobileRelayController(mock(MobileRelayStoreService.class));
    MobileVersionObjectControllerTest(){ReflectionTestUtils.setField(controller,"versionObjects",objects);}

    @Test void everyObjectEndpointRequiresAuthenticatedSessionBeforeLookingUpContent() {
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession(null)).thenReturn(null);
            assertThrows(UnauthorizedException.class,()->controller.versionObjects(null,"device","42"));
            assertThrows(UnauthorizedException.class,()->controller.versionObjectStatus(null,"a".repeat(64),"device","42",2));
            assertThrows(UnauthorizedException.class,()->controller.versionObjectPart(null,"a".repeat(64),0,"device","42",2,"b".repeat(64),new MockHttpServletRequest()));
            assertThrows(UnauthorizedException.class,()->controller.completeVersionObject(null,"a".repeat(64),"device","42",2));
            assertThrows(UnauthorizedException.class,()->controller.versionObjectContent(null,"a".repeat(64),0,"device","42"));
            verifyNoInteractions(objects);
        }
    }
    @Test void unknownLengthAndOversizedRequestsNeverReadOrStoreBody() {
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(7L);
            var request=mock(jakarta.servlet.http.HttpServletRequest.class);
            when(request.getContentLengthLong()).thenReturn(-1L);
            assertThrows(IllegalArgumentException.class,()->controller.versionObjectPart("session","a".repeat(64),0,"device","42",2,"b".repeat(64),request));
            when(request.getContentLengthLong()).thenReturn(MobileVersionObjectService.PART_BYTES+1);
            assertThrows(IllegalArgumentException.class,()->controller.versionObjectPart("session","a".repeat(64),0,"device","42",2,"b".repeat(64),request));
            verifyNoInteractions(objects);verify(request,never()).getInputStream();
        } catch(java.io.IOException e){throw new AssertionError(e);}
    }
    @Test void partBodyIsFullyReadBeforeThePersistentPutStarts() throws Exception {
        try(var auth=mockStatic(AuthController.class)) {
            auth.when(()->AuthController.getUserIdFromSession("session")).thenReturn(7L);
            byte[] payload="hello".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            var wire=new java.io.ByteArrayInputStream(payload);
            var reachedEof=new java.util.concurrent.atomic.AtomicBoolean();
            var stream=new jakarta.servlet.ServletInputStream() {
                @Override public boolean isFinished(){return wire.available()==0;}
                @Override public boolean isReady(){return true;}
                @Override public void setReadListener(jakarta.servlet.ReadListener listener){}
                @Override public int read(){int v=wire.read();if(v<0)reachedEof.set(true);return v;}
            };
            var request=mock(jakarta.servlet.http.HttpServletRequest.class);
            when(request.getContentLengthLong()).thenReturn((long)payload.length);
            when(request.getInputStream()).thenReturn(stream);
            var seen=new java.util.concurrent.atomic.AtomicReference<byte[]>();
            var eofBeforePut=new java.util.concurrent.atomic.AtomicBoolean();
            when(objects.put(eq(7L),eq("device"),eq("42"),anyString(),eq(5L),eq(0),anyString(),any(java.io.InputStream.class),eq(5L)))
                    .thenAnswer(inv->{
                        eofBeforePut.set(reachedEof.get());
                        java.io.InputStream passed=inv.getArgument(7);
                        assertNotSame(stream,passed);
                        seen.set(passed.readAllBytes());
                        return java.util.Map.of("ok",true);
                    });
            controller.versionObjectPart("session","a".repeat(64),0,"device","42",5,"b".repeat(64),request);
            assertTrue(eofBeforePut.get(),"请求体应在 put（事务+属主锁）开始前读完");
            assertArrayEquals(payload,seen.get());
        }
    }
}
