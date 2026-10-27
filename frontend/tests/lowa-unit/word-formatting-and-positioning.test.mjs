// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/zetaoffice/public/office_thread.js', import.meta.url), 'utf8');

function extractSlice(startMarker, endMarker) {
  const s = source.indexOf(startMarker);
  assert.ok(s >= 0, `Could not find start marker: ${startMarker}`);
  const e = source.indexOf(endMarker, s);
  assert.ok(e > s, `Could not find end marker: ${endMarker}`);
  return source.slice(s, e);
}

function createFakeParagraph(text, initialProps = {}, runs = null) {
  const props = {
    CharHeight: 10.5,
    CharHeightAsian: 12,
    CharHeightComplex: 12,
    CharFontName: 'Calibri',
    CharFontNameAsian: '宋体',
    CharFontNameComplex: 'Calibri',
    CharWeight: 100,
    CharWeightAsian: 100,
    CharWeightComplex: 100,
    CharPosture: { value: 0 },
    CharPostureAsian: { value: 0 },
    CharUnderline: 0,
    CharStrikeout: 0,
    CharColor: -1,
    CharHighlight: -1,
    ParaStyleName: 'Standard',
    ParaAdjust: 0,
    ParaLineSpacing: { Mode: 0, Height: 100 },
    ParaTopMargin: 0,
    ParaBottomMargin: 0,
    ParaFirstLineIndent: 0,
    ParaLeftMargin: 0,
    ParaRightMargin: 0,
    OutlineLevel: 0,
    NumberingIsNumber: false,
    NumberingLevel: 0,
    NumberingStyleName: '',
    ListId: '',
    ListLabelString: '',
    ...initialProps,
  };
  const portionList = runs || [];
  const para = {
    _text: text,
    props,
    portions: portionList,
    getString() { return this._text; },
    getStart() { return { para: this, edge: 'start', getString: () => '' }; },
    getEnd() { return { para: this, edge: 'end', getString: () => '' }; },
    getText() {
      const selfPara = this;
      return {
        createTextCursorByRange() {
          return {
            getString() { return selfPara._text; },
            gotoStartOfParagraph() {},
            gotoEndOfParagraph() {},
            goRight() { return true; },
            setPropertyValue(k, v) {
              selfPara.setPropertyValue(k, v);
              for (const run of portionList) {
                run.setPropertyValue(k, v);
              }
            },
          };
        },
      };
    },
    getPropertyValue(k) {
      return props[k];
    },
    setPropertyValue(k, v) {
      props[k] = v;
    },
    createEnumeration() {
      let idx = 0;
      return {
        hasMoreElements: () => idx < portionList.length,
        nextElement: () => portionList[idx++],
      };
    },
    supportsService(svc) {
      return svc === 'com.sun.star.text.Paragraph';
    },
  };
  return para;
}

function buildTestHarness(paragraphs) {
  const vcState = {
    collapsed: true,
    selectedParas: paragraphs[0] ? [paragraphs[0]] : [],
    props: { ...(paragraphs[0] ? paragraphs[0].props : {}) },
  };
  const vc = {
    gotoRange(r, expand) {
      const targetPara = r?.para || r;
      if (!expand) {
        vcState.selectedParas = targetPara ? [targetPara] : [];
        vcState.collapsed = !(r && typeof r.supportsService === 'function');
      } else {
        const startPara = vcState.selectedParas[0] || targetPara;
        const sIdx = Math.max(0, paragraphs.indexOf(startPara));
        const eIdx = Math.max(sIdx, paragraphs.indexOf(targetPara));
        vcState.selectedParas = paragraphs.slice(sIdx, eIdx + 1);
        vcState.collapsed = false;
      }
      if (targetPara && targetPara.props) {
        vcState.props = targetPara.props;
      }
    },
    isCollapsed() { return vcState.collapsed; },
    getString() {
      return vcState.collapsed ? '' : vcState.selectedParas.map((p) => p.getString()).join('\n');
    },
    getStart() { return (vcState.selectedParas[0] || paragraphs[0]).getStart(); },
    getEnd() { return (vcState.selectedParas[vcState.selectedParas.length - 1] || paragraphs[0]).getEnd(); },
    getText() {
      return {
        createTextCursorByRange() {
          return {
            createEnumeration() {
              let i = 0;
              return {
                hasMoreElements: () => i < vcState.selectedParas.length,
                nextElement: () => vcState.selectedParas[i++],
              };
            },
          };
        },
      };
    },
    getPropertyValue(k) { return vcState.props[k]; },
    setPropertyValue(k, v) { vcState.props[k] = v; },
  };

  let nextAnchorSeq = 1;
  const anchors = new Map();
  const xModel = {
    getText: () => ({
      createEnumeration: () => {
        let i = 0;
        return {
          hasMoreElements: () => i < paragraphs.length,
          nextElement: () => paragraphs[i++],
        };
      },
    }),
    getTextTables: () => ({ getCount: () => 0 }),
    createSearchDescriptor: () => ({
      setSearchString(s) { this._s = s; },
      setPropertyValue() {},
    }),
    findFirst: () => null,
    findNext: () => null,
    createInstance: () => ({
      getCount: () => 3,
      getByIndex: () => [],
      replaceByIndex: () => {},
    }),
  };

  const context = {
    console,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    Error,
    JSON,
    isFinite,
    parseInt,
    parseFloat,
    self: {},
    zetajs: {
      Any: function (_t, v) { return v; },
      type: { short: 'short', unsigned_long: 'ulong' },
    },
    css: {
      awt: {
        FontWeight: { BOLD: 150, NORMAL: 100 },
        FontSlant: { ITALIC: { value: 2 }, NONE: { value: 0 } },
        FontUnderline: { NONE: 0, SINGLE: 1, DOUBLE: 2, DOTTED: 3, DASH: 5, WAVE: 10, BOLD: 12 },
        FontStrikeout: { NONE: 0, SINGLE: 1 },
      },
      style: {
        ParagraphAdjust: { LEFT: { value: 0 }, RIGHT: { value: 1 }, BLOCK: { value: 2 }, CENTER: { value: 3 }, STRETCH: { value: 4 } },
        LineSpacingMode: { PROP: 0, MINIMUM: 1, LEADING: 2, FIX: 3 },
        LineSpacing: function ({ Mode, Height }) { this.Mode = Mode; this.Height = Height; },
        NumberingType: {
          CHARS_UPPER_LETTER: 0,
          CHARS_LOWER_LETTER: 1,
          ROMAN_UPPER: 2,
          ROMAN_LOWER: 3,
          ARABIC: 4,
          CHAR_SPECIAL: 6,
          NUMBER_LOWER_ZH: 15,
        },
      },
      text: {
        VertOrientation: { TOP: 0, CENTER: 1, BOTTOM: 2 },
      },
    },
    xModel,
    ctrl: {
      getViewCursor: () => vc,
      select: (r) => { vc.gotoRange(r, false); },
    },
    exportInFlight: false,
    mkProp: (Name, Value) => ({ Name, Value }),
    lockModel: () => {},
    unlockModel: () => {},
    verifySnapshot: () => ({}),
    currentTextTable: () => null,
    styleTableStandard: () => {},
    batchBreak: async () => false,
    postProgress: () => {},
    dispatchUno: () => {},
    tableFail: (msg) => ({ success: false, error: msg, message: msg }),
    errStr: (e) => String(e && e.message || e),
    log: () => {},
    anchorBookmark: (r) => {
      const id = 'anc_' + (nextAnchorSeq++);
      anchors.set(id, r);
      return id;
    },
    anchorRange: (id) => anchors.get(id) || null,
    contextAround: () => ({ before: '', after: '' }),
    paragraphTextOf: (r) => {
      const p = r?.para || r;
      return typeof p?.getString === 'function' ? p.getString() : '';
    },
  };

  const numberingHelpersCode = extractSlice(
    'function paragraphNumberingOf(paragraph)',
    'function pad2(n)'
  );
  const formatHelpersCode = extractSlice(
    '// ---- 格式原语的取值映射',
    'function applyProfileToStyles()'
  );
  const makeNumberingCode = extractSlice(
    'function makeNumberingRules(preset)',
    'function currentTextTable(p)'
  );
  const houseDocHelpersCode = extractSlice(
    '// ---- 全文按画像格式化',
    '// ---- 流式写入状态机'
  );

  const execMethods = [
    ['find_text_locations(p)', '  // [verified-extend] replace the Nth (0-based) match under RecordChanges.'],
    ['get_clauses()', '  // [verified-extend] move the view cursor to doc start/end'],
    ['select_paragraph(p)', '  // [定位] drop the cursor at the start/end edge'],
    ['format_selection(p)', '  // [格式] 表格格式：边框/字号/首行加粗居中'],
    ['get_formatting(p)', '  // [样式画像] 换用项目画像'],
  ].map(([s, e]) => extractSlice('  ' + s + ' {', e)).join('\n');

  vm.createContext(context);
  vm.runInContext(
    numberingHelpersCode + '\n' +
    formatHelpersCode + '\n' +
    makeNumberingCode + '\n' +
    houseDocHelpersCode + '\n' +
    'globalThis.EXEC = {\n' + execMethods + '\n};',
    context
  );
  return { context, EXEC: context.EXEC, vcState };
}

test('定位修复：自动编号条款（第一条、（一））在 get_clauses 与 find_text_locations 中均可识别', () => {
  const p0 = createFakeParagraph('技术服务协议');
  const p1 = createFakeParagraph('定义与解释', {
    NumberingIsNumber: true,
    ListLabelString: '第一条',
    ListId: 'L1',
    NumberingLevel: 0,
  });
  const p2 = createFakeParagraph('本协议所称技术服务指软件研发与维护。');
  const p3 = createFakeParagraph('服务范围', {
    NumberingIsNumber: true,
    ListLabelString: '第二条',
    ListId: 'L1',
    NumberingLevel: 0,
  });
  const { EXEC } = buildTestHarness([p0, p1, p2, p3]);

  const clauses = EXEC.get_clauses({});
  assert.equal(clauses.clauseCount, 2);
  assert.equal(clauses.clauses[0].title, '第一条 定义与解释');
  assert.equal(clauses.clauses[0].autoNumbered, true);
  assert.equal(clauses.clauses[0].listLabel, '第一条');
  assert.equal(clauses.clauses[0].startParagraph, 1);
  assert.equal(clauses.clauses[0].endParagraph, 2);
  assert.equal(clauses.clauses[1].title, '第二条 服务范围');

  // XSearchable 搜不到自动编号前缀 "第一条"，但 find_text_locations 回退匹配自动编号标签
  const found = EXEC.find_text_locations({ keyword: '第一条' });
  assert.equal(found.count, 1);
  assert.equal(found.matches[0].paragraphIndex, 1);
  assert.equal(found.matches[0].matchedViaNumberingLabel, true);
  assert.equal(found.matches[0].numbering.label, '第一条');
});

test('定位修复：只有（一）（二）子款编号的协议也能通过 get_clauses 识别结构', () => {
  const p0 = createFakeParagraph('保密承诺书');
  const p1 = createFakeParagraph('保密信息范围', {
    NumberingIsNumber: true,
    ListLabelString: '（一）',
    ListId: 'L2',
    NumberingLevel: 0,
  });
  const p2 = createFakeParagraph('保密期限为三年', {
    NumberingIsNumber: true,
    ListLabelString: '（二）',
    ListId: 'L2',
    NumberingLevel: 0,
  });
  const { EXEC } = buildTestHarness([p0, p1, p2]);
  const clauses = EXEC.get_clauses({});
  assert.equal(clauses.clauseCount, 2);
  assert.equal(clauses.clauses[0].title, '（一）保密信息范围');
  assert.equal(clauses.clauses[1].title, '（二）保密期限为三年');
});

test('选区范围与字符格式穿透：select_paragraph 支持 endIndex，format_selection 支持段落范围与中西文字体/中文字号/下划线线型并穿透 run', () => {
  const run1 = { props: { CharFontNameAsian: '黑体', CharHeight: 16 }, getPropertyValue(k) { return this.props[k]; }, setPropertyValue(k, v) { this.props[k] = v; } };
  const run2 = { props: { CharFontNameAsian: '微软雅黑', CharHeight: 10.5 }, getPropertyValue(k) { return this.props[k]; }, setPropertyValue(k, v) { this.props[k] = v; } };
  const p0 = createFakeParagraph('标题');
  const p1 = createFakeParagraph('第一段正文', {}, [run1, run2]);
  const p2 = createFakeParagraph('第二段正文');
  const { EXEC } = buildTestHarness([p0, p1, p2]);

  const sel = EXEC.select_paragraph({ index: 1, endIndex: 2 });
  assert.equal(sel.success, true);
  assert.equal(sel.index, 1);
  assert.equal(sel.endIndex, 2);
  assert.equal(sel.paragraphCount, 2);

  const fmt = EXEC.format_selection({
    startParagraph: 1,
    endParagraph: 2,
    fontNameAsian: '仿宋_GB2312',
    fontNameWestern: 'Times New Roman',
    fontSize: '四号',
    underlineStyle: 'double',
    bold: false,
  });
  assert.equal(fmt.success, true);
  assert.equal(fmt.paragraphCount, 2);
  assert.equal(p1.props.CharFontNameAsian, '仿宋_GB2312');
  assert.equal(p1.props.CharFontName, 'Times New Roman');
  assert.equal(p1.props.CharHeight, 14);
  assert.equal(p1.props.CharHeightAsian, 14);
  assert.equal(p1.props.CharUnderline, 2);
  // 段落内的局部 run 直接格式也被一并穿透覆盖
  assert.equal(run1.props.CharFontNameAsian, '仿宋_GB2312');
  assert.equal(run1.props.CharHeightAsian, 14);
  assert.equal(run2.props.CharFontNameAsian, '仿宋_GB2312');
  assert.equal(run2.props.CharHeightAsian, 14);
  assert.equal(p2.props.CharFontNameAsian, '仿宋_GB2312');
});

test('段落格式六项修复：首行缩进按 CharHeightAsian 计算、0 缩进清理残留左缩进、行距支持倍数与别名、批量段落范围', () => {
  // CharHeight(西文)=10.5pt，但 CharHeightAsian(中文)=14pt（四号字）
  const p0 = createFakeParagraph('四号字正文一', {
    CharHeight: 10.5,
    CharHeightAsian: 14,
    ParaLeftMargin: 740,
  });
  const p1 = createFakeParagraph('四号字正文二', {
    CharHeight: 10.5,
    CharHeightAsian: 14,
  });
  const { EXEC } = buildTestHarness([p0, p1]);

  // 1) 首行缩进 2 字符：应按 14pt * 2 = 28pt (988 mm100) 计算，而非 10.5pt * 2 = 21pt
  const res1 = EXEC.set_paragraph_format({
    startParagraph: 0,
    endParagraph: 1,
    firstLineIndentChars: 2,
    lineSpacingMode: 'multiple',
    lineSpacingValue: 1.5,
    spaceBeforePt: 6,
    spaceAfterPt: 12,
  });
  assert.equal(res1.success, true);
  assert.equal(res1.paragraphCount, 2);
  assert.equal(p0.props.ParaFirstLineIndent, Math.round(28 * 2540 / 72));
  assert.equal(p1.props.ParaFirstLineIndent, Math.round(28 * 2540 / 72));
  assert.equal(p0.props.ParaLineSpacing.Mode, 0);
  assert.equal(p0.props.ParaLineSpacing.Height, 150);
  assert.equal(p0.props.ParaTopMargin, Math.round(6 * 2540 / 72));
  assert.equal(p0.props.ParaBottomMargin, Math.round(12 * 2540 / 72));

  // 2) 取消首行缩进（firstLineIndentChars: 0）：对非编号段落同时清零残留 ParaLeftMargin
  EXEC.set_paragraph_format({
    startParagraph: 0,
    firstLineIndentChars: 0,
    lineSpacingMode: 'fixed',
    lineSpacingValue: 22,
  });
  assert.equal(p0.props.ParaFirstLineIndent, 0);
  assert.equal(p0.props.ParaLeftMargin, 0);
  assert.equal(p0.props.ParaLineSpacing.Mode, 3);
  assert.equal(p0.props.ParaLineSpacing.Height, Math.round(22 * 2540 / 72));

  // 3) get_formatting 读回指定段落索引，验证 6 项格式与首行缩进字符数
  const readback = EXEC.get_formatting({ paragraphIndex: 1 });
  assert.equal(readback.paragraphIndex, 1);
  assert.equal(readback.paragraph.firstLineIndentChars, 2);
  assert.equal(readback.paragraph.lineSpacing.mode, 'proportional');
  assert.equal(readback.paragraph.lineSpacing.percent, 150);
  assert.equal(readback.paragraph.spaceBeforePt, 6);
  assert.equal(readback.paragraph.spaceAfterPt, 12);
});

test('标准格式与自动编号兼容：apply_house_style 支持自定义覆盖、识别条款标题、自动编号列表项不叠加首行缩进', async () => {
  const p0 = createFakeParagraph('委托代理合同');
  const p1 = createFakeParagraph('第一条 委托事项');
  const p2 = createFakeParagraph('代为起草协议', {
    NumberingIsNumber: true,
    ListLabelString: '（一）',
    ListId: 'L1',
    NumberingLevel: 0,
  });
  const p3 = createFakeParagraph('普通正文段落应当首行缩进两字符。');
  const { EXEC } = buildTestHarness([p0, p1, p2, p3]);

  const res = await EXEC.apply_house_style({
    fontNameAsian: '宋体',
    fontNameWestern: 'Times New Roman',
    fontSize: 12,
    lineSpacingMode: '1.5',
  });
  assert.equal(res.success, true);
  // p0 是主标题：居中、加粗、不缩进
  assert.equal(p0.props.ParaFirstLineIndent, 0);
  assert.equal(p0.props.CharWeight, 150);
  // p1 是条款标题（第一条）：加粗
  assert.equal(p1.props.CharWeight, 150);
  // p2 是带自动编号的正文列表项：不额外加 2 字符首行缩进（避免双重缩进）
  assert.equal(p2.props.ParaFirstLineIndent, 0);
  assert.equal(p2.props.CharFontNameAsian, '宋体');
  // p3 是普通正文：首行缩进 2 字符（24pt），1.5 倍行距（150%）
  assert.equal(p3.props.ParaFirstLineIndent, Math.round(24 * 2540 / 72));
  assert.equal(p3.props.ParaLineSpacing.Mode, 0);
  assert.equal(p3.props.ParaLineSpacing.Height, 150);
  assert.equal(p3.props.CharFontNameAsian, '宋体');
  assert.equal(p3.props.CharFontName, 'Times New Roman');
});
