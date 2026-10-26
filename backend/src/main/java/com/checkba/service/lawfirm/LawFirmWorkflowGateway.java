// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.lawfirm;
import com.checkba.service.LangText;
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
        if(!LawFirmWorkflowService.ACTIONS.contains(action))throw new IllegalArgumentException(LangText.of("不支持的利冲协作操作", "Unsupported conflict collaboration action"));
        if(!local)return service.execute(userId,action,params);
        String fingerprint=account.accountFingerprintOrNull();
        if(fingerprint==null)throw new IllegalArgumentException(LangText.of("请连接官方账户后使用律所利冲协作", "Please connect an official account before using law firm conflict collaboration"));
        var connection=cloud.connectOfficial(userId);
        if(!fingerprint.equals(connection.getAccountFingerprint())||!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
        try {
            byte[] payload=mapper.writeValueAsBytes(Map.of("action",action,"params",params==null?Map.of():params));
            if(payload.length>128*1024)throw new IllegalArgumentException(LangText.of("利冲摘要过长", "Conflict summary is too long"));
            var request=HttpRequest.newBuilder(URI.create(connection.getServerUrl()+"/api/lawfirm/workflow"))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type","application/json").header("X-Session-Id",connection.getDeviceToken()).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());byte[] bytes;
            try(var stream=new com.checkba.util.DeadlineInputStream(response.body(),Duration.ofSeconds(30))){bytes=stream.readNBytes(1024*1024+1);}
            if(!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
            if(response.statusCode()==404)throw new IllegalArgumentException(LangText.of("云端尚未升级利冲协作，请稍后重试", "Cloud conflict collaboration has not been upgraded yet; please try again later"));
            if(response.statusCode()!=200||bytes.length>1024*1024)throw new IllegalArgumentException(LangText.of("云端利冲协作暂不可用，请重试", "Cloud conflict collaboration is temporarily unavailable; please try again"));
            Map<String,Object> envelope=mapper.readValue(bytes,new TypeReference<>(){});
            if(!(envelope.get("code") instanceof Number n)||n.intValue()!=0)throw new IllegalArgumentException(Objects.toString(envelope.get("message"),LangText.of("利冲操作未完成", "Conflict check action did not complete")));
            return mapper.convertValue(envelope.get("data"),new TypeReference<>(){});
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalArgumentException(LangText.of("操作已取消", "Operation cancelled"));}
        catch(java.io.IOException e){throw new IllegalArgumentException(LangText.of("云端暂时无法连接；本机台账没有代替发送，请重试", "Unable to connect to the cloud; local ledger did not send on your behalf, please retry"));}
    }
    private static IllegalArgumentException changed(){return new IllegalArgumentException(LangText.of("账户已变化，请重新打开律所管理", "Account has changed; please reopen Law Firm Management"));}
}
