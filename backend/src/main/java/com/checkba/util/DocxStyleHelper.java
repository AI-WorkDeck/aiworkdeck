package com.checkba.util;

import org.docx4j.openpackaging.packages.WordprocessingMLPackage;
import org.docx4j.openpackaging.parts.WordprocessingML.StyleDefinitionsPart;
import org.docx4j.wml.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Helper class to add missing styles to a WordprocessingMLPackage.
 * This fixes the "Couldn't find style: BodyText" and "Couldn't find style: Quotations"
 * errors that occur when using flexmark-docx-converter with docx4j.
 * 
 * These styles are used by flexmark when rendering markdown elements like blockquotes.
 */
public class DocxStyleHelper {
    
    private static final Logger log = LoggerFactory.getLogger(DocxStyleHelper.class);
    
    /**
     * Adds missing styles (BodyText, Quotations) to the WordprocessingMLPackage.
     * This should be called after WordprocessingMLPackage.createPackage() and
     * before DocxRenderer.render().
     * 
     * @param wordMLPackage The WordprocessingMLPackage to add styles to
     */
    public static void addMissingStyles(WordprocessingMLPackage wordMLPackage) {
        try {
            StyleDefinitionsPart stylesPart = wordMLPackage.getMainDocumentPart().getStyleDefinitionsPart();
            if (stylesPart == null) {
                log.warn("StyleDefinitionsPart is null, cannot add missing styles");
                return;
            }
            
            Styles styles = stylesPart.getJaxbElement();
            if (styles == null) {
                log.warn("Styles element is null, cannot add missing styles");
                return;
            }
            
            // Add BodyText style if not present
            if (!hasStyle(styles, "BodyText")) {
                styles.getStyle().add(createBodyTextStyle());
                log.debug("Added BodyText style to document");
            }
            
            // Add Quotations style if not present
            if (!hasStyle(styles, "Quotations")) {
                styles.getStyle().add(createQuotationsStyle());
                log.debug("Added Quotations style to document");
            }

            // Add ParagraphTextBody style if not present
            if (!hasStyle(styles, "ParagraphTextBody")) {
                styles.getStyle().add(createParagraphTextBodyStyle());
                log.debug("Added ParagraphTextBody style to document");
            }
            
        } catch (Exception e) {
            log.warn("Failed to add missing styles, document may still work but with warnings: {}", e.getMessage());
        }
    }
    
    /**
     * Checks if a style with the given ID already exists
     */
    private static boolean hasStyle(Styles styles, String styleId) {
        for (Style style : styles.getStyle()) {
            if (styleId.equals(style.getStyleId())) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Creates a BodyText paragraph style
     */
    private static Style createBodyTextStyle() {
        ObjectFactory factory = new ObjectFactory();
        
        Style style = factory.createStyle();
        style.setType("paragraph");
        style.setStyleId("BodyText");
        
        // Set style name
        Style.Name styleName = factory.createStyleName();
        styleName.setVal("Body Text");
        style.setName(styleName);
        
        // Base on Normal style
        Style.BasedOn basedOn = factory.createStyleBasedOn();
        basedOn.setVal("Normal");
        style.setBasedOn(basedOn);
        
        // Paragraph properties
        PPr pPr = factory.createPPr();
        
        // Add spacing after paragraph
        PPrBase.Spacing spacing = factory.createPPrBaseSpacing();
        spacing.setAfter(java.math.BigInteger.valueOf(200)); // 10pt spacing after
        spacing.setLine(java.math.BigInteger.valueOf(276)); // 1.15 line spacing
        spacing.setLineRule(STLineSpacingRule.AUTO);
        pPr.setSpacing(spacing);
        
        style.setPPr(pPr);
        
        return style;
    }
    
    /**
     * Creates a Quotations paragraph style (for blockquotes)
     */
    private static Style createQuotationsStyle() {
        ObjectFactory factory = new ObjectFactory();
        
        Style style = factory.createStyle();
        style.setType("paragraph");
        style.setStyleId("Quotations");
        
        // Set style name
        Style.Name styleName = factory.createStyleName();
        styleName.setVal("Quote");
        style.setName(styleName);
        
        // Base on Normal style
        Style.BasedOn basedOn = factory.createStyleBasedOn();
        basedOn.setVal("Normal");
        style.setBasedOn(basedOn);
        
        // Paragraph properties
        PPr pPr = factory.createPPr();
        
        // Add left indent for quote appearance
        PPrBase.Ind indent = factory.createPPrBaseInd();
        indent.setLeft(java.math.BigInteger.valueOf(720)); // 0.5 inch left indent
        pPr.setInd(indent);
        
        // Add spacing
        PPrBase.Spacing spacing = factory.createPPrBaseSpacing();
        spacing.setBefore(java.math.BigInteger.valueOf(100)); // 5pt before
        spacing.setAfter(java.math.BigInteger.valueOf(100)); // 5pt after
        pPr.setSpacing(spacing);
        
        style.setPPr(pPr);
        
        // Run properties (italic for quote style)
        RPr rPr = factory.createRPr();
        BooleanDefaultTrue italic = factory.createBooleanDefaultTrue();
        italic.setVal(true);
        rPr.setI(italic);
        
        // Gray color for quotes
        Color color = factory.createColor();
        color.setVal("666666");
        rPr.setColor(color);
        
        style.setRPr(rPr);
        
        return style;
    }

    /**
     * Creates a ParagraphTextBody paragraph style (for general text body)
     */
    private static Style createParagraphTextBodyStyle() {
        ObjectFactory factory = new ObjectFactory();
        
        Style style = factory.createStyle();
        style.setType("paragraph");
        style.setStyleId("ParagraphTextBody");
        
        // Set style name
        Style.Name styleName = factory.createStyleName();
        styleName.setVal("Paragraph Text Body");
        style.setName(styleName);
        
        // Base on Normal style
        Style.BasedOn basedOn = factory.createStyleBasedOn();
        basedOn.setVal("Normal");
        style.setBasedOn(basedOn);
        
        // Paragraph properties
        PPr pPr = factory.createPPr();
        
        // Add spacing
        PPrBase.Spacing spacing = factory.createPPrBaseSpacing();
        spacing.setBefore(java.math.BigInteger.valueOf(0)); 
        spacing.setAfter(java.math.BigInteger.valueOf(120)); // 6pt after
        spacing.setLine(java.math.BigInteger.valueOf(240)); // 1.0 line spacing
        spacing.setLineRule(STLineSpacingRule.AUTO);
        pPr.setSpacing(spacing);
        
        style.setPPr(pPr);
        
        return style;
    }
}
