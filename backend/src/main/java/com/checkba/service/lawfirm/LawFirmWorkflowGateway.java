// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;
import com.checkba.service.account.AccountService;
import com.checkba.version.OfficialCloudService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;

/** No user-supplied endpoint and no fallback to the legacy local ledger. */
@Service
public class LawFirmWorkflowGateway {
    private final boolean local;
    private final OfficialCloudService cloud;
    private final AccountService account;
    private final LawFirmWorkflowService service;
    private final ObjectMapper mapper;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
    public LawFirmWorkflowGateway(@Value("${security.local-mode:false}") boolean local,OfficialCloudService cloud,AccountService account,LawFirmWorkflowService service,ObjectMapper mapper){this.local=local;this.cloud=cloud;this.account=account;this.service=service;this.mapper=mapper;}
    public Map<String,Object> execute(Long userId,String action,Map<String,Object> params){
        if(!LawFirmWorkflowService.ACTIONS.contains(action))throw new IllegalArgumentException("不支持的利冲协作操作");
        if(!local)return service.execute(userId,action,params);
        String fingerprint=account.accountFingerprintOrNull();
        if(fingerprint==null)throw new IllegalArgumentException("请连接官方账户后使用律所利冲协作");
        var connection=cloud.connectOfficial(userId);
        if(!fingerprint.equals(connection.getAccountFingerprint())||!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
        try {
            byte[] payload=mapper.writeValueAsBytes(Map.of("action",action,"params",params==null?Map.of():params));
            if(payload.length>128*1024)throw new IllegalArgumentException("利冲摘要过长");
            var request=HttpRequest.newBuilder(URI.create(connection.getServerUrl()+"/api/lawfirm/workflow"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type","application/json").header("X-Session-Id",connection.getDeviceToken()).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());byte[] bytes;
            try(var stream=new com.checkba.util.DeadlineInputStream(response.body(),Duration.ofSeconds(30))){bytes=stream.readNBytes(1024*1024+1);}
            if(!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
            if(response.statusCode()==404)throw new IllegalArgumentException("云端尚未升级利冲协作，请稍后重试");
            if(response.statusCode()!=200||bytes.length>1024*1024)throw new IllegalArgumentException("云端利冲协作暂不可用，请重试");
            Map<String,Object> envelope=mapper.readValue(bytes,new TypeReference<>(){});
            if(!(envelope.get("code") instanceof Number n)||n.intValue()!=0)throw new IllegalArgumentException(Objects.toString(envelope.get("message"),"利冲操作未完成"));
            return mapper.convertValue(envelope.get("data"),new TypeReference<>(){});
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalArgumentException("操作已取消");}
        catch(java.io.IOException e){throw new IllegalArgumentException("云端暂时无法连接；本机台账没有代替发送，请重试");}
    }
    private static IllegalArgumentException changed(){return new IllegalArgumentException("账户已变化，请重新打开律所管理");}
}
