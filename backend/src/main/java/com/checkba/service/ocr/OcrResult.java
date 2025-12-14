package com.checkba.service.ocr;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class OcrResult {
    private String text;
    private String raw;
}


