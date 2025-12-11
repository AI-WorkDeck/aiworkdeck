package com.checkba.service;

import cn.hutool.core.util.StrUtil;
import cn.hutool.http.HttpRequest;
import cn.hutool.json.JSONArray;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.model.dto.CompanyBasicInfoDTO;
import com.checkba.model.entity.ProjectVariable;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
public class TushareService {

    @Value("${external.tushare.base-url:http://api.tushare.pro}")
    private String tushareApiUrl;

    @Value("${external.tushare.token:}")
    private String tushareToken;

    /**
     * Fetch listed company data and return a DTO for frontend display.
     */
    public CompanyBasicInfoDTO fetchCompanyInfoDTO(String companyName) {
        String tsCode = getTsCodeByName(companyName);
        if (StrUtil.isBlank(tsCode)) {
            return null;
        }

        CompanyBasicInfoDTO dto = new CompanyBasicInfoDTO();
        dto.setName(companyName);
        dto.setRole("LISTED");
        dto.setStockCode(tsCode);
        dto.setFullName(companyName);

        // Basic Info
        Map<String, String> basicInfo = fetchBasicInfoMap(tsCode);
        if (basicInfo != null) {
            dto.setRegisteredAddress(basicInfo.get("office"));
            dto.setRegisteredCapital(basicInfo.get("reg_capital"));
            // dto.setShortName(basicInfo.get("name"));
        }

        // Top 10 Holders
        dto.setTop10Shareholders(fetchTop10HoldersList(tsCode));

        // Executives
        dto.setExecutives(fetchManagersList(tsCode));

        return dto;
    }

    /**
     * Fetch listed company data and return a list of ProjectVariable objects.
     */
    public List<ProjectVariable> fetchAndCreateVariables(Long projectId, String companyName) {
        List<ProjectVariable> variables = new ArrayList<>();
        String tsCode = getTsCodeByName(companyName);

        if (StrUtil.isBlank(tsCode)) {
            log.warn("Could not find ts_code for company: {}", companyName);
            return variables;
        }

        // 1. Basic Info
        Map<String, String> basicInfo = fetchBasicInfoMap(tsCode);
        if (basicInfo != null) {
            String group = "上市公司-基本信息";
            basicInfo.forEach((k, v) -> createVar(variables, projectId, mapFieldName(k), v, group));
        }

        // 2. Top 10 Holders
        List<Map<String, String>> holders = fetchTop10HoldersList(tsCode);
        if (holders != null && !holders.isEmpty()) {
            String group = "上市公司-前十大股东";
            int index = 1;
            for (Map<String, String> holder : holders) {
                if (index > 10) break;
                createVar(variables, projectId, "第" + index + "大股东名称", holder.get("name"), group);
                createVar(variables, projectId, "第" + index + "大股东持股数", holder.get("amount"), group);
                createVar(variables, projectId, "第" + index + "大股东持股比例", holder.get("ratio"), group);
                index++;
            }
            if (!holders.isEmpty() && holders.get(0).containsKey("date")) {
                createVar(variables, projectId, "股东数据报告期", holders.get(0).get("date"), group);
            }
        }

        // 3. Management
        List<Map<String, String>> managers = fetchManagersList(tsCode);
        if (managers != null && !managers.isEmpty()) {
            String group = "上市公司-管理层";
            Set<String> directors = new LinkedHashSet<>();
            Set<String> supervisors = new LinkedHashSet<>();
            Set<String> executives = new LinkedHashSet<>();

            for (Map<String, String> mgr : managers) {
                String name = mgr.get("name");
                String title = mgr.get("job"); // mapped to 'job' in helper
                if (title.contains("独立董事")) {
                    directors.add(name + "(独董)");
                } else if (title.contains("董事")) {
                    directors.add(name);
                } else if (title.contains("监事")) {
                    supervisors.add(name);
                } else {
                    executives.add(name);
                }
            }
            createVar(variables, projectId, "董事列表", String.join("、", directors), group);
            createVar(variables, projectId, "监事列表", String.join("、", supervisors), group);
            createVar(variables, projectId, "高管列表", String.join("、", executives), group);
        }

        return variables;
    }

    private String getTsCodeByName(String name) {
        JSONObject params = new JSONObject();
        params.put("list_status", "L");
        
        JSONObject response = callTushare("stock_basic", params, "ts_code,name,fullname");
        if (response == null || !response.containsKey("data")) {
            return null;
        }

        JSONObject data = response.getJSONObject("data");
        JSONArray items = data.getJSONArray("items"); 
        
        if (items == null) return null;

        for (Object itemObj : items) {
            JSONArray item = (JSONArray) itemObj;
            String stockName = item.getStr(1);
            String fullName = item.getStr(2);
            if (name.equals(stockName) || name.equals(fullName)) {
                return item.getStr(0);
            }
        }
        return null;
    }

    private Map<String, String> fetchBasicInfoMap(String tsCode) {
        JSONObject params = new JSONObject();
        params.put("ts_code", tsCode);
        String fields = "introduction,main_business,chairman,manager,secretary,reg_capital,setup_date,province,city,website,email,employees,office";
        JSONObject response = callTushare("stock_company", params, fields);
        
        if (response != null && response.containsKey("data")) {
            JSONObject data = response.getJSONObject("data");
            JSONArray items = data.getJSONArray("items");
            JSONArray fieldNames = data.getJSONArray("fields");
            
            if (items != null && !items.isEmpty()) {
                JSONArray item = items.getJSONArray(0);
                Map<String, String> result = new HashMap<>();
                for (int i = 0; i < fieldNames.size(); i++) {
                    result.put(fieldNames.getStr(i), item.getStr(i));
                }
                return result;
            }
        }
        return null;
    }

    private List<Map<String, String>> fetchTop10HoldersList(String tsCode) {
        JSONObject params = new JSONObject();
        params.put("ts_code", tsCode);
        JSONObject response = callTushare("top10_holders", params, "ann_date,end_date,holder_name,hold_amount,hold_ratio");
        
        if (response != null && response.containsKey("data")) {
            JSONObject data = response.getJSONObject("data");
            JSONArray items = data.getJSONArray("items");
            
            if (items != null && !items.isEmpty()) {
                String latestDate = "";
                for (Object itemObj : items) {
                    JSONArray item = (JSONArray) itemObj;
                    String endDate = item.getStr(1);
                    if (endDate != null && endDate.compareTo(latestDate) > 0) {
                        latestDate = endDate;
                    }
                }
                
                if (StrUtil.isNotBlank(latestDate)) {
                    final String targetDate = latestDate;
                    List<Map<String, String>> holders = new ArrayList<>();
                    for (Object itemObj : items) {
                         JSONArray item = (JSONArray) itemObj;
                         if (targetDate.equals(item.getStr(1))) {
                             Map<String, String> map = new HashMap<>();
                             map.put("name", item.getStr(2));
                             map.put("amount", item.getStr(3));
                             map.put("ratio", item.getStr(4));
                             map.put("date", targetDate);
                             // match DTO structure keys for frontend
                             map.put("shareholderName", item.getStr(2)); // DTO might use this or the list config
                             map.put("shares", item.getStr(3)); // match projectTypes.js
                             map.put("shareholdingRatio", item.getStr(4)); // match projectTypes.js
                             holders.add(map);
                         }
                    }
                    return holders;
                }
            }
        }
        return Collections.emptyList();
    }

    private List<Map<String, String>> fetchManagersList(String tsCode) {
        JSONObject params = new JSONObject();
        params.put("ts_code", tsCode);
        JSONObject response = callTushare("stk_managers", params, "name,title,begin_date,end_date");
        
        if (response != null && response.containsKey("data")) {
            JSONObject data = response.getJSONObject("data");
            JSONArray items = data.getJSONArray("items");
            
            if (items != null && !items.isEmpty()) {
                List<Map<String, String>> list = new ArrayList<>();
                for (Object itemObj : items) {
                    JSONArray item = (JSONArray) itemObj;
                    String name = item.getStr(0);
                    String title = item.getStr(1);
                    String begin = item.getStr(2);
                    String end = item.getStr(3);
                    
                    Map<String, String> map = new HashMap<>();
                    map.put("name", name);
                    map.put("position", title);
                    map.put("job", title);
                    map.put("term", (begin != null ? begin : "?") + " - " + (end != null ? end : "?"));
                    list.add(map);
                }
                return list;
            }
        }
        return Collections.emptyList();
    }

    private JSONObject callTushare(String apiName, JSONObject params, String fields) {
        JSONObject body = new JSONObject();
        body.put("api_name", apiName);
        body.put("token", tushareToken);
        body.put("params", params);
        body.put("fields", fields);

        try {
            String result = HttpRequest.post(tushareApiUrl)
                    .body(body.toString())
                    .timeout(10000)
                    .execute()
                    .body();
            return JSONUtil.parseObj(result);
        } catch (Exception e) {
            log.error("Failed to call Tushare API: {}", apiName, e);
            return null;
        }
    }
    
    private void createVar(List<ProjectVariable> variables, Long projectId, String name, String value, String group) {
        ProjectVariable var = new ProjectVariable();
        var.setProjectId(projectId);
        var.setName(name);
        var.setValue(value);
        var.setType("TEXT");
        var.setVariableGroup(group);
        variables.add(var);
    }
    
    private String mapFieldName(String field) {
        switch (field) {
            case "introduction": return "公司简介";
            case "main_business": return "主营业务";
            case "chairman": return "法人代表"; 
            case "manager": return "总经理";
            case "secretary": return "董秘";
            case "reg_capital": return "注册资本";
            case "setup_date": return "成立日期";
            case "province": return "所在省份";
            case "city": return "所在城市";
            case "website": return "公司官网";
            case "email": return "电子邮箱";
            case "employees": return "员工人数";
            case "office": return "办公地址";
            default: return field;
        }
    }
}
