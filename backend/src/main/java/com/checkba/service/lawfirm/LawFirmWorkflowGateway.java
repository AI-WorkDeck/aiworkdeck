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
public class LawFirmWorkflowGateway implements LawFirmCloudCaller {
    private final boolean local;
    private final OfficialCloudService cloud;
    private final AccountService account;
    private final LawFirmWorkflowService service;
    private final ObjectMapper mapper;
    private final HttpClient http=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NEVER).version(HttpClient.Version.HTTP_1_1).build();
    public LawFirmWorkflowGateway(@Value("${security.local-mode:false}") boolean local,OfficialCloudService cloud,AccountService account,LawFirmWorkflowService service,ObjectMapper mapper){this.local=local;this.cloud=cloud;this.account=account;this.service=service;this.mapper=mapper;}
    /** 律所云端统一入口（/api/lawfirm/cloud）的服务端；桌面端用它的功能登记表做白名单。可缺席（旧测试装配）。 */
    private LawFirmCloudService firmCloud;
    @org.springframework.beans.factory.annotation.Autowired(required=false)
    void setFirmCloud(LawFirmCloudService firmCloud){this.firmCloud=firmCloud;}

    public Map<String,Object> execute(Long userId,String action,Map<String,Object> params){
        if(!LawFirmWorkflowService.ACTIONS.contains(action))throw new IllegalArgumentException(LangText.of("不支持的利冲协作操作", "Unsupported conflict collaboration action"));
        if(!local)return service.execute(userId,action,params);
        return forward(userId,"/api/lawfirm/workflow",action,params,128*1024,1024*1024,
                LangText.of("利冲摘要过长", "Conflict summary is too long"),
                LangText.of("云端尚未升级利冲协作，请稍后重试", "Cloud conflict collaboration has not been upgraded yet; please try again later"),
                LangText.of("云端利冲协作暂不可用，请重试", "Cloud conflict collaboration is temporarily unavailable; please try again"),
                LangText.of("利冲操作未完成", "Conflict check action did not complete"),
                LangText.of("请连接官方账户后使用律所利冲协作", "Please connect an official account before using law firm conflict collaboration"));
    }

    /**
     * 律所云端功能（客户与主体、计时工时……）与利冲协作同一套连接：同一官方账户凭据、同一账户指纹核验、同样的超时；
     * 只认服务端登记过的动作（{@link LawFirmCloudService#featureOf}），大小上限按功能定。云端不可用或账户已变化时直接报错，
     * 不回落到本机台账。
     */
    @Override
    public Map<String,Object> call(Long userId,String action,Map<String,Object> params){return executeCloud(userId,action,params);}

    public boolean isCloudAction(String action){return firmCloud!=null&&firmCloud.featureOf(action)!=null;}

    /** 插件桥入口：只放行该插件被登记允许的云端动作（最小权限），其余一律拒绝，不落到本机台账。 */
    public Map<String,Object> executeCloudForPlugin(String pluginId,Long userId,String action,Map<String,Object> params){
        if(firmCloud==null||!firmCloud.pluginMayCall(pluginId,action))
            throw new IllegalArgumentException(LangText.of("该插件无权调用这项律所云端功能", "This plugin is not allowed to call this Firm cloud feature"));
        return executeCloud(userId,action,params);
    }

    public Map<String,Object> executeCloud(Long userId,String action,Map<String,Object> params){
        String feature=firmCloud==null?null:firmCloud.featureOf(action);
        if(feature==null)throw new IllegalArgumentException(LangText.of("不支持的律所云端操作", "Unsupported law firm cloud action"));
        if(!local)return firmCloud.execute(userId,action,params);
        LawFirmCloudFeature f="cloud".equals(feature)?null:firmCloud.registry().get(feature);
        int maxRequest=f==null?64*1024:f.maxRequestBytes(),maxResponse=f==null?256*1024:f.maxResponseBytes();
        return forward(userId,"/api/lawfirm/cloud",action,params,maxRequest,maxResponse,
                LangText.of("一次提交的内容过多，请分批提交", "Too much data in one request; submit in smaller batches"),
                LangText.of("所连接的协作服务尚未升级到支持律所云端的版本", "The connected collaboration service does not support Firm cloud yet"),
                LangText.of("律所云端暂不可用，请重试", "Firm cloud is temporarily unavailable; please try again"),
                LangText.of("律所云端操作未完成", "Firm cloud action did not complete"),
                LangText.of("请先登录并连接官方账户，才能使用律所云端", "Sign in and connect your official account to use Firm cloud"));
    }

    private Map<String,Object> forward(Long userId,String path,String action,Map<String,Object> params,int maxRequest,int maxResponse,
                                       String tooLarge,String notUpgraded,String unavailable,String notCompleted,String needAccount){
        String fingerprint=account.accountFingerprintOrNull();
        if(fingerprint==null)throw new IllegalArgumentException(needAccount);
        var connection=cloud.connectOfficial(userId);
        if(!fingerprint.equals(connection.getAccountFingerprint())||!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
        try {
            byte[] payload=mapper.writeValueAsBytes(Map.of("action",action,"params",params==null?Map.of():params));
            if(payload.length>maxRequest)throw new IllegalArgumentException(tooLarge);
            var request=HttpRequest.newBuilder(URI.create(connection.getServerUrl()+path))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type","application/json").header("X-Session-Id",connection.getDeviceToken()).POST(HttpRequest.BodyPublishers.ofByteArray(payload)).build();
            var response=http.send(request,HttpResponse.BodyHandlers.ofInputStream());byte[] bytes;
            try(var stream=new com.checkba.util.DeadlineInputStream(response.body(),Duration.ofSeconds(30))){bytes=stream.readNBytes(maxResponse+1);}
            if(!fingerprint.equals(account.accountFingerprintOrNull()))throw changed();
            if(response.statusCode()==404)throw new IllegalArgumentException(notUpgraded);
            if(response.statusCode()!=200||bytes.length>maxResponse)throw new IllegalArgumentException(unavailable);
            Map<String,Object> envelope=mapper.readValue(bytes,new TypeReference<>(){});
            if(!(envelope.get("code") instanceof Number n)||n.intValue()!=0)throw new IllegalArgumentException(Objects.toString(envelope.get("message"),notCompleted));
            return mapper.convertValue(envelope.get("data"),new TypeReference<>(){});
        } catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalArgumentException(LangText.of("操作已取消", "Operation cancelled"));}
        catch(java.io.IOException e){throw new IllegalArgumentException(LangText.of("云端暂时无法连接；本机台账没有代替发送，请重试", "Unable to connect to the cloud; local ledger did not send on your behalf, please retry"));}
    }
    private static IllegalArgumentException changed(){return new IllegalArgumentException(LangText.of("账户已变化，请重新打开律所管理", "Account has changed; please reopen Law Firm Management"));}
}
