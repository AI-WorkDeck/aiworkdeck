package com.checkba.controller;

import com.checkba.model.dto.CompanyBasicInfoDTO;
import com.checkba.model.dto.CompanySearchRequest;
import com.checkba.service.CompanyMirrorService;
import com.checkba.service.QichachaService;
import com.checkba.service.StockCodeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/external")
@CrossOrigin(origins = "*") // 允许跨域
public class ExternalController {

    @Autowired
    private QichachaService qichachaService;

    @Autowired
    private CompanyMirrorService companyMirrorService;

    @Autowired
    private StockCodeService stockCodeService;

    @PostMapping("/company/basic")
    public CompanyBasicInfoDTO getCompanyBasicInfo(@RequestBody CompanySearchRequest request) {
        if (request.getName() == null || request.getName().isEmpty()) {
            throw new IllegalArgumentException("Company name is required");
        }

        String original = request.getName().trim();
        String searchKey = original;

        // 如果输入看起来是 6 位股票代码，先通过证券接口解析公司名称，再去企查查查公司
        if (original.matches("\\d{6}")) {
            String resolvedName = stockCodeService.resolveCompanyName(original);
            if (StringUtils.hasText(resolvedName)) {
                searchKey = resolvedName;
            }
        }

        CompanyBasicInfoDTO dto = qichachaService.searchCompany(searchKey, request.getRole());

        // 如果是股票代码查询且企查查返回的 stockCode 为空，则用用户输入的代码兜底
        if (original.matches("\\d{6}") && !StringUtils.hasText(dto.getStockCode())) {
            dto.setStockCode(original);
        }

        // 将查询结果落库，形成“公司镜像”，供“我的客户”模块使用
        companyMirrorService.saveFromExternal(dto, request);
        return dto;
    }
}
