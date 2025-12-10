package com.checkba.service;

import cn.hutool.core.date.DateUtil;
import cn.hutool.core.util.RandomUtil;
import cn.hutool.crypto.SecureUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.http.HttpResponse;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.model.dto.CompanyBasicInfoDTO;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Slf4j
@Service
public class QichachaService {

    @Value("${external.qichacha.key}")
    private String appKey;

    @Value("${external.qichacha.secret}")
    private String secretKey;

    @Value("${external.qichacha.base-url}")
    private String baseUrl;

    /**
     * 调用企查查企业工商详情接口
     */
    public CompanyBasicInfoDTO searchCompany(String searchKey, String role) {
        // 如果是纯 6 位数字，视为股票代码，暂不直接传给企查查，优先按名称处理。
        // 这里保留原实现，但在上层先做一层股票代码 → 公司名称的解析。
        // 1. 准备请求参数
        String timeSpan = String.valueOf(System.currentTimeMillis() / 1000);
        // Token = Md5(key + Timespan + SecretKey)
        String token = SecureUtil.md5(appKey + timeSpan + secretKey).toUpperCase();

        String url = baseUrl + "/ECIInfoVerify/GetInfo";

        try {
            log.info("Requesting Qichacha API: {}, searchKey: {}", url, searchKey);
            
            // 2. 发起请求
            HttpResponse response = HttpRequest.get(url)
                    .form("key", appKey)
                    .form("searchKey", searchKey)
                    .header("Token", token)
                    .header("Timespan", timeSpan)
                    .timeout(30000)
                    .execute();

            String body = response.body();
            log.info("Qichacha response: {}", body);

            JSONObject json = JSONUtil.parseObj(body);
            
            // 检查状态码 (根据企查查文档，通常 Status 为 "200" 表示成功)
            // 注意：具体字段需根据实际返回调整，这里假设 Standard Response Format
            if (!"200".equals(json.getStr("Status"))) {
                log.error("Qichacha API error: {}", json.getStr("Message"));
                throw new RuntimeException("查询失败: " + json.getStr("Message"));
            }

            JSONObject result = json.getJSONObject("Result");
            if (result == null) {
                throw new RuntimeException("未查询到相关企业信息");
            }

            // 3. 映射数据到 DTO
            return mapToDTO(result, role);

        } catch (Exception e) {
            log.error("调用企查查接口异常", e);
            throw new RuntimeException("外部数据服务暂不可用: " + e.getMessage());
        }
    }

    private CompanyBasicInfoDTO mapToDTO(JSONObject data, String role) {
        CompanyBasicInfoDTO dto = new CompanyBasicInfoDTO();

        dto.setRole(role);

        // 通用字段
        dto.setName(data.getStr("Name"));
        dto.setFullName(data.getStr("Name"));
        dto.setRegisteredAddress(data.getStr("Address")); // 注册地址
        dto.setRegisteredCapital(data.getStr("RegistCapi")); // 注册资本

        // 根据角色提取特定字段
        // 注意：上市公司字段（股票代码、收盘价等）通常在普通工商接口里不全，可能需要额外接口。
        // 这里先尽量从 GetInfo 结果里拿，拿不到的留空或模拟。
        
        if ("LISTED".equals(role)) {
            // 上市公司特有逻辑
            // 尝试获取股票代码 (企查查 GetInfo 可能不直接返回最新股价，这里作为示例)
            dto.setStockCode(findStockCode(data)); 
            dto.setShortName(data.getStr("Name")); // 暂用全称代替简称
            // 这些字段 GetInfo 接口可能没有，需要用 "GetStockInfo" 等接口，这里暂时给假数据或空
            dto.setBoard("主板 (需对接证券接口)");
            dto.setTotalShares("暂无数据");
            dto.setLatestClosePrice("暂无数据");

            // 股东 (Partners) -> 前十大股东
            dto.setTop10Shareholders(mapShareholders(data.getJSONArray("Partners"), 10));
            
            // 董监高 (Employees)
            dto.setExecutives(mapExecutives(data.getJSONArray("Employees")));
        } else {
            // 标的公司逻辑
            // 股权结构说明
            dto.setEquityStructureRemark("请参考详细股东信息");
            
            // 股东信息
            dto.setShareholders(mapShareholders(data.getJSONArray("Partners"), 100));
        }

        return dto;
    }

    private String findStockCode(JSONObject data) {
        // 尝试查找上市公司代码逻辑，部分接口直接有 StockNumber 等字段
        // 这里简单检查是否有相关字段
        return data.getStr("No"); // 临时用注册号/No占位
    }

    private List<Map<String, String>> mapShareholders(JSONArray partners, int limit) {
        List<Map<String, String>> list = new ArrayList<>();
        if (partners == null) return list;

        for (int i = 0; i < Math.min(partners.size(), limit); i++) {
            JSONObject p = partners.getJSONObject(i);
            Map<String, String> map = new HashMap<>();
            map.put("name", p.getStr("StockName")); // 股东名称
            map.put("shareholdingRatio", p.getStr("StockPercent")); // 比例
            
            // 出资额 / 持股数
            String cap = p.getStr("ShouldCapi"); // 认缴出资额
            if (cap == null) cap = p.getStr("SubscribedCapital");
            map.put("contribution", cap);
            map.put("shares", "-"); // 接口未直接返回持股数时用 -

            list.add(map);
        }
        return list;
    }

    private List<Map<String, String>> mapExecutives(JSONArray employees) {
        List<Map<String, String>> list = new ArrayList<>();
        if (employees == null) return list;

        for (int i = 0; i < employees.size(); i++) {
            JSONObject e = employees.getJSONObject(i);
            Map<String, String> map = new HashMap<>();
            map.put("name", e.getStr("Name"));
            map.put("position", e.getStr("Job"));
            map.put("term", "-"); // 接口通常不含任期
            list.add(map);
        }
        return list;
    }
}

