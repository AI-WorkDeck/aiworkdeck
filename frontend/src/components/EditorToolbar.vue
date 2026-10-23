<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<template>
  <view class="etb-wrap">
  <view class="etb" @tap="closeMenus">
    <!-- 主命令区：窄了就横向滚动，不换行（换行会把画布挤下去）。
         原生横向滚动条有 15px 高，会把这一段撑到 41px、在 38px 的行里被
         align-items:center 顶得比右侧常驻区高半格（dev-board#502），但整条藏掉
         又等于把「这里还能往右滚」从界面上抹掉（dev-board#543）——所以改成 4px
         悬浮细滑轨（.awd-hairline-scroll，定义在 App.vue 全局样式里）。
         滚轮转横滚**不能写成这里的 @wheel**：uni 会把事件重建成普通对象，
         currentTarget 不是 DOM、连 delta 都没有，整条是死的（dev-board#543 复发的
         正是这一步）——改在 mounted 里用原生 addEventListener 挂，见
         utils/horizontalWheel.js 与本组件的 bindToolbarWheel。 -->
    <view class="etb-scroll-wrap">
    <scroll-view class="etb-scroll awd-hairline-scroll" scroll-x>
      <view class="etb-row">
        <!-- 撤销 / 重做 -->
        <view class="etb-btn" :class="{ off: undoDisabled }" :title="$t('editor.toolbar.undo')" @tap.stop="run('undo')">
          <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.undo" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </view>
        <view class="etb-btn" :class="{ off: redoDisabled }" :title="$t('editor.toolbar.redo')" @tap.stop="run('redo')">
          <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.redo" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </view>
        <view class="etb-sep"></view>

        <!-- PPT (impress) 幻灯片导航与新建（ElyOffice slides.rs） -->
        <template v-if="isImpress">
          <view class="etb-btn" :class="{ off: (impressState.slideNumber || 1) <= 1 }" :title="$t('editor.toolbar.impressPrevSlide')" @tap.stop="prevSlide">
            <text class="etb-tx b">‹</text>
          </view>
          <view class="etb-drop" :class="{ open: menu === 'impressSlide' }">
            <view ref="trig_impressSlide" class="etb-field w96" :class="{ on: menu === 'impressSlide' }" :title="$t('editor.toolbar.impressSlideTitle')" @tap.stop="openImpressSlideMenu">
              <text class="etb-field-t">{{ $t('editor.toolbar.impressSlideCounter', { n: impressState.slideNumber || 1, total: impressState.slideCount || 1 }) }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'impressSlide'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.impressSlideTitle') }}</text>
                <text class="etb-pg-chip ok" @tap.stop="addImpressSlide">{{ $t('editor.toolbar.impressNewSlide') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressSlideNavSection') }}</text>
              <view class="etb-pg-chips">
                <text v-for="idx in (impressState.slideCount || 1)" :key="'sl-' + idx" class="etb-pg-chip" :class="{ on: idx === (impressState.slideNumber || 1) }" @tap.stop="gotoSlide(idx)">#{{ idx }}</text>
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="moveImpressSlide(-1)">{{ $t('editor.toolbar.impressMoveUp') }}</text>
                <text class="etb-pg-chip" @tap.stop="moveImpressSlide(1)">{{ $t('editor.toolbar.impressMoveDown') }}</text>
                <text class="etb-pg-chip" @tap.stop="moveImpressSlideTo(1)">{{ $t('editor.toolbar.impressMoveFirst') }}</text>
                <text class="etb-pg-chip" @tap.stop="moveImpressSlideTo(impressState.slideCount || 1)">{{ $t('editor.toolbar.impressMoveLast') }}</text>
                <text class="etb-pg-chip danger" @tap.stop="deleteImpressSlide">{{ $t('editor.toolbar.impressDeleteSlide') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressLayoutSection') }}</text>
              <view class="etb-pg-chips">
                <text v-for="ly in IMPRESS_LAYOUTS" :key="ly.code" class="etb-pg-chip" :class="{ on: impressState.layout === ly.code }" @tap.stop="applyImpressLayout(ly.code)">{{ $t('editor.toolbar.' + ly.label) }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressMasterSizeSection') }}</text>
              <view v-if="impressState.masterPages && impressState.masterPages.length > 1" class="etb-pg-chips">
                <text v-for="mp in impressState.masterPages" :key="mp" class="etb-pg-chip" :class="{ on: impressState.masterName === mp }" @tap.stop="applyImpressMaster(mp)">{{ mp }}</text>
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="applyImpressSlideSize(338.67, 190.5)">{{ $t('editor.toolbar.impressSlideSize169') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyImpressSlideSize(254, 190.5)">{{ $t('editor.toolbar.impressSlideSize43') }}</text>
              </view>
              <text v-if="impressErr" class="etb-err">{{ impressErr }}</text>
            </view>
          </view>
          <view class="etb-btn" :class="{ off: (impressState.slideNumber || 1) >= (impressState.slideCount || 1) }" :title="$t('editor.toolbar.impressNextSlide')" @tap.stop="nextSlide">
            <text class="etb-tx b">›</text>
          </view>
          <view class="etb-btn wide" :title="$t('editor.toolbar.impressNewSlide')" @tap.stop="addImpressSlide">
            <text class="etb-tx sm">{{ $t('editor.toolbar.impressNewSlide') }}</text>
          </view>
          <view class="etb-sep"></view>
        </template>

        <!-- 段落样式 (Writer only) -->
        <view v-if="isWriter" class="etb-drop" :class="{ open: menu === 'style' }">
          <view ref="trig_style" class="etb-field w110" :title="$t('editor.toolbar.paraStyle')" @tap.stop="toggleMenu('style')">
            <text class="etb-field-t">{{ styleLabel }}</text>
            <text class="etb-caret">⌄</text>
          </view>
          <scroll-view v-if="menu === 'style'" class="etb-menu w160" :style="popStyle(160)" scroll-y @tap.stop>
            <view v-for="s in styleOptions" :key="s.name" class="etb-item"
                  :class="{ on: s.name === state.paragraph.styleName }" @tap.stop="applyStyle(s.name)">
              <text class="etb-item-t">{{ s.label }}</text>
            </view>
          </scroll-view>
        </view>

        <!-- 字体 -->
        <view class="etb-drop" :class="{ open: menu === 'font' }">
          <view ref="trig_font" class="etb-field w110" :title="$t('editor.toolbar.font')" @tap.stop="toggleMenu('font')">
            <text class="etb-field-t">{{ fontLabel }}</text>
            <text class="etb-caret">⌄</text>
          </view>
          <scroll-view v-if="menu === 'font'" class="etb-menu w180" :style="popStyle(180)" scroll-y @tap.stop>
            <view v-if="systemFontsSupported" class="etb-item etb-item-manage" @tap.stop="openSystemFonts">
              <text class="etb-item-t">{{ $t('editor.systemFonts.manageEntry') }}</text>
            </view>
            <view v-for="f in fontOptions" :key="f" class="etb-item"
                  :class="{ on: f === state.character.font }" @tap.stop="applyFont(f)">
              <text class="etb-item-t">{{ f }}</text>
            </view>
          </scroll-view>
        </view>

        <!-- 字号：引擎的 .uno:Grow/Shrink 是哑弹，这里读回当前值自己步进；中间的数值
             点开是字号下拉（中文字号 + 磅值）。没有选区也能设（Word 语义：之后在光标处
             敲的字用新字号），见 office_thread.js format_selection 的 atCursor。 -->
        <view class="etb-drop" :class="{ open: menu === 'size' }">
          <view ref="trig_size" class="etb-stepper" :title="$t('editor.toolbar.fontSize')">
            <text class="etb-step-b" @tap.stop="stepSize(-1)">−</text>
            <text class="etb-step-v pick" @tap.stop="toggleMenu('size')">{{ sizeLabel }}</text>
            <text class="etb-step-b" @tap.stop="stepSize(1)">+</text>
          </view>
          <scroll-view v-if="menu === 'size'" class="etb-menu w120" :style="popStyle(120)" scroll-y @tap.stop>
            <template v-if="showCnSizes">
              <view v-for="s in CN_FONT_SIZES" :key="'cn' + s.pt" class="etb-item"
                    :class="{ on: sizeMatches(s.pt) }" @tap.stop="setSize(s.pt)">
                <text class="etb-item-t">{{ s.name }}</text>
                <text class="etb-hint">{{ s.pt }}</text>
              </view>
              <view class="etb-menu-sep"></view>
            </template>
            <view v-for="pt in PT_FONT_SIZES" :key="'pt' + pt" class="etb-item"
                  :class="{ on: sizeMatches(pt) }" @tap.stop="setSize(pt)">
              <text class="etb-item-t">{{ pt }}</text>
            </view>
          </scroll-view>
        </view>
        <view class="etb-sep"></view>

        <!-- 字符格式 -->
        <view class="etb-btn" :class="{ on: state.character.bold }" :title="$t('editor.toolbar.bold')" @tap.stop="ui('bold')"><text class="etb-tx b">B</text></view>
        <view class="etb-btn" :class="{ on: state.character.italic }" :title="$t('editor.toolbar.italic')" @tap.stop="ui('italic')"><text class="etb-tx i">I</text></view>
        <view class="etb-btn" :class="{ on: state.character.underline }" :title="$t('editor.toolbar.underline')" @tap.stop="ui('underline')"><text class="etb-tx u">U</text></view>
        <view class="etb-btn" :class="{ on: state.character.strikeout }" :title="$t('editor.toolbar.strikeout')" @tap.stop="ui('strikeout')"><text class="etb-tx s">S</text></view>
        <view v-if="isWriter" class="etb-btn" :class="{ on: state.character.superscript }" :title="$t('editor.toolbar.superscript')" @tap.stop="ui('superscript')"><text class="etb-tx">X²</text></view>
        <view v-if="isWriter" class="etb-btn" :class="{ on: state.character.subscript }" :title="$t('editor.toolbar.subscript')" @tap.stop="ui('subscript')"><text class="etb-tx">X₂</text></view>

        <!-- 字色 / 高亮(或单元格填充) -->
        <view class="etb-drop" :class="{ open: menu === 'color' }">
          <view ref="trig_color" class="etb-btn" :title="$t('editor.toolbar.textColor')" @tap.stop="toggleMenu('color')">
            <text class="etb-tx">A</text>
            <view class="etb-swatch" :style="{ background: state.character.color === 'auto' ? 'var(--awd-text)' : state.character.color }"></view>
          </view>
          <view v-if="menu === 'color'" class="etb-palette" :style="popStyle(128)" @tap.stop>
            <view v-for="c in TEXT_COLORS" :key="c.v" class="etb-chip" :style="{ background: c.v === 'auto' ? 'var(--awd-text)' : c.v }"
                  :title="$t('editor.toolbar.colors.' + c.t)" @tap.stop="applyColor('color', c.v)"></view>
          </view>
        </view>
        <view class="etb-drop" :class="{ open: menu === 'hl' }">
          <view ref="trig_hl" class="etb-btn" :title="isCalc ? $t('editor.toolbar.cellFillColor') : $t('editor.toolbar.highlight')" @tap.stop="toggleMenu('hl')">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.marker" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <view class="etb-swatch" :style="{ background: state.character.highlight === 'none' ? 'transparent' : state.character.highlight }"></view>
          </view>
          <view v-if="menu === 'hl'" class="etb-palette" :style="popStyle(128)" @tap.stop>
            <view v-for="c in HL_COLORS" :key="c.v" class="etb-chip" :class="{ none: c.v === 'none' }"
                  :style="{ background: c.v === 'none' ? '#fff' : c.v }" :title="$t('editor.toolbar.colors.' + c.t)" @tap.stop="applyColor('highlight', c.v)"></view>
          </view>
        </view>
        <view class="etb-btn" :title="$t('editor.toolbar.clearFormatting')" @tap.stop="ui('clear_formatting')">
          <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.clear" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </view>
        <view class="etb-sep"></view>

        <!-- 对齐 -->
        <view v-for="a in ALIGNS" :key="a.k" class="etb-btn" :class="{ on: state.paragraph.alignment === a.k }"
              :title="$t('editor.toolbar.' + a.t)" @tap.stop="ui(a.cmd)">
          <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS[a.icon]" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        </view>

        <!-- Writer 专有段落与列表命令 -->
        <template v-if="isWriter">
          <view class="etb-btn" :class="{ on: state.paragraph.listKind === 'bullet' }" :title="$t('editor.toolbar.bulletList')" @tap.stop="ui('bullet_list')">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.bullet" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </view>
          <view class="etb-btn" :class="{ on: state.paragraph.listKind === 'number' }" :title="$t('editor.toolbar.numberList')" @tap.stop="ui('number_list')">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.number" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          </view>
          <view class="etb-btn" :title="$t('editor.toolbar.indentLess')" @tap.stop="ui('indent_less')">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.outdent" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </view>
          <view class="etb-btn" :title="$t('editor.toolbar.indentMore')" @tap.stop="ui('indent_more')">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.indent" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </view>
          <!-- 段落格式快捷面板：首行缩进 / 缩进方式 / 段前段后 / 行距 + 一键预设 + 全文交给 AI。
               LO 自己的段落对话框在本构建上键盘关不掉，不能挂（doc-editor.md），所以是自建面板。 -->
          <view class="etb-drop" :class="{ open: menu === 'para' }">
            <view ref="trig_para" class="etb-btn wide" :class="{ on: menu === 'para' }" :title="$t('editor.format.buttonTitle')" @tap.stop="openParagraphPanel">
              <text class="etb-tx sm">{{ $t('editor.format.button') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'para'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <ParagraphFormatPanel :call="call" :has-selection="!noSelection"
                                    @applied="onParagraphApplied" @ai-format="onAiFormat" @house-style="runHouseStyle" />
            </view>
          </view>
          <view class="etb-sep"></view>

          <!-- 插入 (Writer) -->
          <view class="etb-drop" :class="{ open: menu === 'insert' }">
            <view ref="trig_insert" class="etb-field w72" :class="{ on: menu === 'insert' }" :title="$t('editor.toolbar.insert')" @tap.stop="openInsert">
              <text class="etb-field-t">{{ $t('editor.toolbar.insert') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'insert'" class="etb-menu w240 pad etb-prop-card" :style="popStyle(240, true)" @tap.stop>
              <!-- 一级清单 -->
              <template v-if="!insertMode">
                <view class="etb-item" @tap.stop="insertMode = 'table'"><text class="etb-item-t">{{ $t('editor.toolbar.insertTable') }}</text></view>
                <view class="etb-item" @tap.stop="pickImage"><text class="etb-item-t">{{ $t('editor.toolbar.insertImage') }}</text></view>
                <view class="etb-item" :class="{ dim: noSelection }" @tap.stop="startLink">
                  <text class="etb-item-t">{{ $t('editor.toolbar.insertLink') }}</text>
                  <text v-if="noSelection" class="etb-hint">{{ $t('editor.toolbar.needSelection') }}</text>
                </view>
                <view class="etb-item" :class="{ dim: noSelection }" @tap.stop="startComment">
                  <text class="etb-item-t">{{ $t('editor.toolbar.insertComment') }}</text>
                  <text v-if="noSelection" class="etb-hint">{{ $t('editor.toolbar.needSelection') }}</text>
                </view>
                <view class="etb-menu-sep"></view>
                <view class="etb-item" @tap.stop="startToc"><text class="etb-item-t">{{ $t('editor.toolbar.insertToc') }}</text></view>
                <view class="etb-item" @tap.stop="startPageNumber"><text class="etb-item-t">{{ $t('editor.toolbar.insertPageNumber') }}</text></view>
                <view class="etb-item" @tap.stop="ui('page_break')"><text class="etb-item-t">{{ $t('editor.toolbar.insertPageBreak') }}</text></view>
                <view class="etb-item" @tap.stop="startText('footnote')"><text class="etb-item-t">{{ $t('editor.toolbar.insertFootnote') }}</text></view>
                <view class="etb-item" @tap.stop="startText('header')"><text class="etb-item-t">{{ $t('editor.toolbar.editHeader') }}</text></view>
                <view class="etb-item" @tap.stop="startText('footer')"><text class="etb-item-t">{{ $t('editor.toolbar.editFooter') }}</text></view>
              </template>

              <!-- 脚注 / 尾注 / 页眉 / 页脚：同一个单行文本表单 -->
              <view v-else-if="TEXT_FORMS[insertMode]" class="etb-form">
                <text class="etb-form-t">{{ $t('editor.toolbar.' + TEXT_FORMS[insertMode].title) }}</text>
                <textarea class="etb-input ta" v-model="formText"
                          :placeholder="$t('editor.toolbar.' + TEXT_FORMS[insertMode].ph)" @click.stop />
                <view class="etb-form-acts">
                  <text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text>
                  <text class="etb-form-b ok" @tap.stop="doTextForm">{{ $t('editor.toolbar.confirm') }}</text>
                </view>
              </view>

              <!-- 目录（ElyOffice PropertyGroup 表单） -->
              <view v-else-if="insertMode === 'toc'" class="etb-form">
                <text class="etb-form-t">{{ $t('editor.toolbar.tocTitle') }}</text>
                <input class="etb-input" v-model="tocForm.title" :placeholder="$t('editor.toolbar.tocDefaultTitle')" @click.stop />
                <view class="etb-pg-grid compact">
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tocLevels') }}</text>
                  <view class="etb-seg">
                    <text v-for="lv in [2, 3, 4]" :key="lv" class="etb-seg-b" :class="{ on: tocForm.levels === lv }" @tap.stop="tocForm.levels = lv">1-{{ lv }}</text>
                  </view>
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tocPosition') }}</text>
                  <view class="etb-seg">
                    <text class="etb-seg-b" :class="{ on: tocForm.position === 'cursor' }" @tap.stop="tocForm.position = 'cursor'">{{ $t('editor.toolbar.tocAtCursor') }}</text>
                    <text class="etb-seg-b" :class="{ on: tocForm.position === 'start' }" @tap.stop="tocForm.position = 'start'">{{ $t('editor.toolbar.tocAtStart') }}</text>
                  </view>
                </view>
                <view class="etb-form-acts">
                  <text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text>
                  <text class="etb-form-b ok" @tap.stop="doInsertToc">{{ $t('editor.toolbar.confirm') }}</text>
                </view>
              </view>

              <!-- 页码（ElyOffice PropertyGroup 表单） -->
              <view v-else-if="insertMode === 'pageNumber'" class="etb-form">
                <text class="etb-form-t">{{ $t('editor.toolbar.pageNumberTitle') }}</text>
                <view class="etb-pg-grid compact">
                  <text class="etb-pg-l">{{ $t('editor.toolbar.pageNumberPos') }}</text>
                  <view class="etb-seg">
                    <text class="etb-seg-b" :class="{ on: pageNumForm.target === 'footer' }" @tap.stop="pageNumForm.target = 'footer'">{{ $t('editor.toolbar.pageNumberFooter') }}</text>
                    <text class="etb-seg-b" :class="{ on: pageNumForm.target === 'header' }" @tap.stop="pageNumForm.target = 'header'">{{ $t('editor.toolbar.pageNumberHeader') }}</text>
                  </view>
                  <text class="etb-pg-l">{{ $t('editor.toolbar.pageNumberAlign') }}</text>
                  <view class="etb-seg">
                    <text class="etb-seg-b" :class="{ on: pageNumForm.align === 'left' }" @tap.stop="pageNumForm.align = 'left'">{{ $t('editor.format.align.left') }}</text>
                    <text class="etb-seg-b" :class="{ on: pageNumForm.align === 'center' }" @tap.stop="pageNumForm.align = 'center'">{{ $t('editor.format.align.center') }}</text>
                    <text class="etb-seg-b" :class="{ on: pageNumForm.align === 'right' }" @tap.stop="pageNumForm.align = 'right'">{{ $t('editor.format.align.right') }}</text>
                  </view>
                </view>
                <view class="etb-pg-chips">
                  <text v-for="p in PAGE_NUM_PATTERNS" :key="p.k" class="etb-pg-chip" :class="{ on: pageNumForm.pattern === p.pattern }" @tap.stop="pageNumForm.pattern = p.pattern">{{ $t('editor.toolbar.' + p.label) }}</text>
                </view>
                <view class="etb-form-acts">
                  <text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text>
                  <text class="etb-form-b ok" @tap.stop="doInsertPageNumber">{{ $t('editor.toolbar.confirm') }}</text>
                </view>
              </view>

              <!-- 表格：网格选择器 -->
              <view v-else-if="insertMode === 'table'" class="etb-form">
                <text class="etb-form-t">{{ grid.r ? $t('editor.toolbar.gridSize', { rows: grid.r, cols: grid.c }) : $t('editor.toolbar.gridPrompt') }}</text>
                <view class="etb-grid">
                  <view v-for="cell in GRID_CELLS" :key="cell.k" class="etb-cell"
                        :class="{ hot: cell.r <= grid.r && cell.c <= grid.c }"
                        @mouseenter="grid = { r: cell.r, c: cell.c }" @tap.stop="doInsertTable(cell.r, cell.c)"></view>
                </view>
                <view class="etb-form-acts"><text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text></view>
              </view>

              <!-- 超链接 -->
              <view v-else-if="insertMode === 'link'" class="etb-form">
                <text class="etb-form-t">{{ $t('editor.toolbar.linkTitle', { sel: selPreview }) }}</text>
                <input class="etb-input" v-model="linkUrl" :placeholder="$t('editor.toolbar.linkPlaceholder')" @click.stop />
                <view class="etb-form-acts">
                  <text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text>
                  <text class="etb-form-b ok" @tap.stop="doLink">{{ $t('editor.toolbar.confirm') }}</text>
                </view>
              </view>

              <!-- 批注 -->
              <view v-else-if="insertMode === 'comment'" class="etb-form">
                <text class="etb-form-t">{{ commentFormTitle }}</text>
                <textarea class="etb-input ta" v-model="commentText" :placeholder="$t('editor.toolbar.commentPlaceholder')" @click.stop />
                <view class="etb-form-acts">
                  <text class="etb-form-b" @tap.stop="insertMode = ''">{{ $t('editor.toolbar.cancel') }}</text>
                  <text class="etb-form-b ok" @tap.stop="doComment">{{ $t('editor.toolbar.confirm') }}</text>
                </view>
              </view>
              <text v-if="insertErr" class="etb-err">{{ insertErr }}</text>
            </view>
          </view>

          <!-- 页面设置（ElyOffice PropertyGroup 检查器卡片：纸张方向、纸张大小、页边距预设与自定义、标尺/标记） -->
          <view class="etb-drop" :class="{ open: menu === 'page' }">
            <view ref="trig_page" class="etb-field w72" :class="{ on: menu === 'page' }" :title="$t('editor.toolbar.pageSetup')" @tap.stop="openPageMenu">
              <text class="etb-field-t">{{ $t('editor.toolbar.page') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'page'" class="etb-menu w280 pad etb-prop-card" :style="popStyle(280, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.pageSetup') }}</text>
              </view>
              <view class="etb-pg-grid">
                <text class="etb-pg-l">{{ $t('editor.toolbar.pageOrientation') }}</text>
                <view class="etb-seg">
                  <text class="etb-seg-b" :class="{ on: pageForm.orientation === 'portrait' }" @tap.stop="applyPageOrientation('portrait')">{{ $t('editor.toolbar.portrait') }}</text>
                  <text class="etb-seg-b" :class="{ on: pageForm.orientation === 'landscape' }" @tap.stop="applyPageOrientation('landscape')">{{ $t('editor.toolbar.landscape') }}</text>
                </view>
                <text class="etb-pg-l">{{ $t('editor.toolbar.paperSize') }}</text>
                <view class="etb-pg-chips">
                  <text v-for="p in PAPER_SIZES" :key="p.k" class="etb-pg-chip" :class="{ on: pageForm.paper === p.k }" @tap.stop="applyPaperSize(p)">{{ p.label }}</text>
                </view>
                <text class="etb-pg-l">{{ $t('editor.toolbar.marginPresets') }}</text>
                <view class="etb-pg-chips">
                  <text v-for="m in MARGIN_PRESETS" :key="m.k" class="etb-pg-chip" @tap.stop="useMarginPreset(m)">{{ $t('editor.toolbar.marginPreset_' + m.k) }}</text>
                </view>
              </view>
              <view class="etb-menu-sep"></view>
              <view class="etb-pg-subhead">
                <text class="etb-pg-sec">{{ $t('editor.toolbar.marginsCm') }}</text>
                <text class="etb-form-b ok sm" @tap.stop="applyPageMargins">{{ $t('editor.toolbar.applyMargins') }}</text>
              </view>
              <view class="etb-margin-grid">
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.marginTop') }}</text>
                  <input class="etb-num" type="digit" v-model="pageForm.topCm" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.marginBottom') }}</text>
                  <input class="etb-num" type="digit" v-model="pageForm.bottomCm" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.marginLeft') }}</text>
                  <input class="etb-num" type="digit" v-model="pageForm.leftCm" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.marginRight') }}</text>
                  <input class="etb-num" type="digit" v-model="pageForm.rightCm" @click.stop />
                </view>
              </view>
              <view class="etb-menu-sep"></view>
              <view class="etb-pg-grid">
                <text class="etb-pg-l">{{ $t('editor.toolbar.viewAssist') }}</text>
                <view class="etb-pg-chips">
                  <text class="etb-pg-chip" :class="{ on: rulerOn }" @tap.stop="toggleRuler">{{ $t('editor.toolbar.ruler') }}</text>
                  <text class="etb-pg-chip" :class="{ on: formattingMarks }" @tap.stop="setAllMarks(!formattingMarks)">{{ $t('editor.toolbar.formattingMarks') }} ¶</text>
                </view>
              </view>
              <text v-if="pageErr" class="etb-err">{{ pageErr }}</text>
            </view>
          </view>

          <view class="etb-drop" :class="{ open: menu === 'marks' }">
            <button ref="trig_marks" class="etb-btn etb-marks-trigger" :class="{ on: formattingMarks }"
                    :title="$t('editor.toolbar.specialCharacters')" :aria-label="$t('editor.toolbar.specialCharacters')"
                    aria-haspopup="true" :disabled="!viewPrefsReady" :aria-expanded="menu === 'marks'" @tap.stop="toggleMenu('marks')">
              <text class="etb-tx">¶</text><text class="etb-caret">⌄</text>
            </button>
            <view v-if="menu === 'marks'" class="etb-menu w200 etb-marks-menu" :style="popStyle(210, true)" @tap.stop>
              <text class="etb-form-t">{{ $t('editor.toolbar.specialCharacters') }}</text>
              <button class="etb-item" :disabled="viewPrefsBusy" @tap.stop="setAllMarks(true)">{{ $t('editor.toolbar.showAllMarks') }}</button>
              <button class="etb-item" :disabled="viewPrefsBusy" @tap.stop="setAllMarks(false)">{{ $t('editor.toolbar.hideAllMarks') }}</button>
              <view class="etb-menu-sep"></view>
              <button v-for="option in MARK_OPTIONS" :key="option.key" class="etb-item" role="checkbox"
                      :data-mark="option.key" :aria-checked="markVisible(option.key)" :disabled="viewPrefsBusy"
                      @tap.stop="setMark(option.key, !markVisible(option.key))">
                <text>{{ $t('editor.toolbar.' + option.label) }}</text>
                <text aria-hidden="true">{{ markVisible(option.key) ? '☑' : '☐' }}</text>
              </button>
            </view>
          </view>
          <view class="etb-btn" :class="{ on: rulerOn }" :title="$t('editor.toolbar.ruler')" @tap.stop="toggleRuler">
            <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.ruler" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </view>

          <!-- 表格上下文组：光标在表格里才出现 -->
          <template v-if="inTable">
            <view class="etb-sep"></view>
            <view class="etb-drop" :class="{ open: menu === 'table' }">
              <view ref="trig_table" class="etb-btn wide" :class="{ on: menu === 'table' }" :title="$t('editor.toolbar.tablePropsTitle')" @tap.stop="openTableMenu">
                <text class="etb-tx sm">{{ $t('editor.toolbar.tableGroup') }}</text>
                <text class="etb-caret">⌄</text>
              </view>
              <view v-if="menu === 'table'" class="etb-menu w260 pad etb-prop-card" :style="popStyle(260, true)" @tap.stop>
                <view class="etb-pg-head">
                  <text class="etb-pg-title">{{ $t('editor.toolbar.tablePropsTitle') }}</text>
                  <text class="etb-pg-chip ok" @tap.stop="applyTableFormat({ applyStandard: true })">{{ $t('editor.toolbar.tableStandardPreset') }}</text>
                </view>
                <view class="etb-pg-grid">
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tableBorders') }}</text>
                  <view class="etb-seg">
                    <text v-for="b in TABLE_BORDER_OPTIONS" :key="b.k" class="etb-seg-b" :class="{ on: tableForm.borderPreset === b.k }" @tap.stop="applyTableFormat({ borderPreset: b.k })">{{ $t('editor.toolbar.' + b.label) }}</text>
                  </view>
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tableHeaderFill') }}</text>
                  <view class="etb-pg-swatches">
                    <view v-for="c in TABLE_FILL_SWATCHES" :key="c" class="etb-chip" :class="{ none: c === 'none', on: tableForm.headerFill === c }" :style="{ background: c === 'none' ? '#fff' : c }" @tap.stop="applyTableFormat({ headerFill: c })"></view>
                  </view>
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tableVAlign') }}</text>
                  <view class="etb-seg">
                    <text v-for="v in TABLE_VALIGNS" :key="v.k" class="etb-seg-b" :class="{ on: tableForm.cellVerticalAlign === v.k }" @tap.stop="applyTableFormat({ cellVerticalAlign: v.k })">{{ $t('editor.toolbar.' + v.label) }}</text>
                  </view>
                  <text class="etb-pg-l">{{ $t('editor.toolbar.tableRepeatHeader') }}</text>
                  <view class="etb-pg-chips">
                    <text class="etb-pg-chip" :class="{ on: tableForm.repeatHeader }" @tap.stop="applyTableFormat({ repeatHeader: !tableForm.repeatHeader })">{{ $t('editor.toolbar.tableRepeatHeaderToggle') }}</text>
                  </view>
                </view>
                <text v-if="tableErr" class="etb-err">{{ tableErr }}</text>
              </view>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.rowAbove')" @tap.stop="tableOp('rowAbove')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.rowAbove" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.rowBelow')" @tap.stop="tableOp('rowBelow')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.rowBelow" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.colLeft')" @tap.stop="tableOp('colLeft')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.colLeft" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.colRight')" @tap.stop="tableOp('colRight')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.colRight" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.deleteRow')" @tap.stop="tableOp('delRow')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.delRow" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
            <view class="etb-btn" :title="$t('editor.toolbar.deleteCol')" @tap.stop="tableOp('delCol')">
              <svg class="etb-ico" viewBox="0 0 24 24" fill="none"><path v-for="(d,i) in ICONS.delCol" :key="i" :d="d" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
            </view>
          </template>
        </template>

        <!-- Excel (calc) 专有命令与 ElyOffice PropertyGroup 卡片 (apps/ely-table/src/tabs/*.rs) -->
        <template v-if="isCalc">
          <view class="etb-btn wide" :class="{ on: calcState.wrap }" :title="$t('editor.toolbar.wrapText')" @tap.stop="toggleCalcWrap">
            <text class="etb-tx sm">{{ $t('editor.toolbar.wrapTextShort') }}</text>
          </view>
          <view class="etb-btn wide" :class="{ on: calcState.merged }" :title="$t('editor.toolbar.mergeCells')" @tap.stop="toggleCalcMerge">
            <text class="etb-tx sm">{{ $t('editor.toolbar.mergeCellsShort') }}</text>
          </view>
          <view class="etb-sep"></view>

          <!-- 数字格式 ⌄ (ElyOffice number_group) -->
          <view class="etb-drop" :class="{ open: menu === 'calcNumber' }">
            <view ref="trig_calcNumber" class="etb-field w96" :class="{ on: menu === 'calcNumber' }" :title="$t('editor.toolbar.calcNumberFormat')" @tap.stop="openCalcMenu('calcNumber')">
              <text class="etb-field-t">{{ $t('editor.toolbar.calcNumberFormat') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'calcNumber'" class="etb-menu w280 pad etb-prop-card" :style="popStyle(280, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.calcNumberFormat') }}</text>
              </view>
              <view class="etb-pg-chips">
                <text v-for="nf in CALC_NUM_FORMATS" :key="nf.k" class="etb-pg-chip" :class="{ on: calcCustomNumFmt === nf.code }" @tap.stop="applyCalcNumberFormat(nf.code)">{{ $t('editor.toolbar.' + nf.label) }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcCustomNumFmt') }}</text>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcCustomNumFmt" :placeholder="$t('editor.toolbar.calcCustomNumPh')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="applyCalcNumberFormat(calcCustomNumFmt)">{{ $t('editor.toolbar.calcApplyFormat') }}</text>
              </view>
              <text v-if="calcErr" class="etb-err">{{ calcErr }}</text>
            </view>
          </view>

          <!-- 单元格与行列 ⌄ (ElyOffice cell_group & cells.rs) -->
          <view class="etb-drop" :class="{ open: menu === 'calcCells' }">
            <view ref="trig_calcCells" class="etb-field w110" :class="{ on: menu === 'calcCells' }" :title="$t('editor.toolbar.calcCellsTitle')" @tap.stop="openCalcMenu('calcCells')">
              <text class="etb-field-t">{{ $t('editor.toolbar.calcCellsGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'calcCells'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.calcCellsTitle') }}</text>
              </view>
              <view class="etb-pg-grid">
                <text class="etb-pg-l">{{ $t('editor.toolbar.tableVAlign') }}</text>
                <view class="etb-seg">
                  <text class="etb-seg-b" :class="{ on: calcState.vAlign === 'top' }" @tap.stop="applyCalcVAlign('top')">{{ $t('editor.toolbar.tableVAlignTop') }}</text>
                  <text class="etb-seg-b" :class="{ on: calcState.vAlign === 'center' }" @tap.stop="applyCalcVAlign('center')">{{ $t('editor.toolbar.tableVAlignCenter') }}</text>
                  <text class="etb-seg-b" :class="{ on: calcState.vAlign === 'bottom' }" @tap.stop="applyCalcVAlign('bottom')">{{ $t('editor.toolbar.tableVAlignBottom') }}</text>
                </view>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcBorderSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="applyCalcBorder('all', 0.75)">{{ $t('editor.toolbar.calcBorderAll') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcBorder('outer', 0.75)">{{ $t('editor.toolbar.calcBorderOuter') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcBorder('outer', 1.5)">{{ $t('editor.toolbar.calcBorderThickOuter') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcBorder('bottom', 1.0)">{{ $t('editor.toolbar.calcBorderBottom') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcBorder('none', 0)">{{ $t('editor.toolbar.calcBorderNone') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcRowColEditSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="editCalcRowsCols('insert_rows', 'before')">{{ $t('editor.toolbar.rowAbove') }}</text>
                <text class="etb-pg-chip" @tap.stop="editCalcRowsCols('insert_rows', 'after')">{{ $t('editor.toolbar.rowBelow') }}</text>
                <text class="etb-pg-chip danger" @tap.stop="editCalcRowsCols('delete_rows')">{{ $t('editor.toolbar.deleteRow') }}</text>
                <text class="etb-pg-chip" @tap.stop="editCalcRowsCols('insert_cols', 'before')">{{ $t('editor.toolbar.colLeft') }}</text>
                <text class="etb-pg-chip" @tap.stop="editCalcRowsCols('insert_cols', 'after')">{{ $t('editor.toolbar.colRight') }}</text>
                <text class="etb-pg-chip danger" @tap.stop="editCalcRowsCols('delete_cols')">{{ $t('editor.toolbar.deleteCol') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <view class="etb-pg-subhead">
                <text class="etb-pg-sec">{{ $t('editor.toolbar.calcRowColSizeSection') }}</text>
                <text class="etb-form-b ok sm" @tap.stop="applyCalcRowColSize">{{ $t('editor.toolbar.calcApplySize') }}</text>
              </view>
              <view class="etb-margin-grid">
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.calcRowHeight') }}</text>
                  <input class="etb-num" type="digit" v-model="calcSizeForm.rowHeightPt" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.calcColWidth') }}</text>
                  <input class="etb-num" type="digit" v-model="calcSizeForm.colWidthPt" @click.stop />
                </view>
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="autoFitCalc('rows')">{{ $t('editor.toolbar.calcAutoFitRow') }}</text>
                <text class="etb-pg-chip" @tap.stop="autoFitCalc('cols')">{{ $t('editor.toolbar.calcAutoFitCol') }}</text>
              </view>
              <text v-if="calcErr" class="etb-err">{{ calcErr }}</text>
            </view>
          </view>

          <!-- 数据 ⌄ (ElyOffice data.rs) -->
          <view class="etb-drop" :class="{ open: menu === 'calcData' }">
            <view ref="trig_calcData" class="etb-field w72" :class="{ on: menu === 'calcData' }" :title="$t('editor.toolbar.calcDataTitle')" @tap.stop="openCalcMenu('calcData')">
              <text class="etb-field-t">{{ $t('editor.toolbar.calcDataGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'calcData'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.calcDataTitle') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcSortFilterSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="sortCalcRange(true)">{{ $t('editor.toolbar.calcSortAsc') }}</text>
                <text class="etb-pg-chip" @tap.stop="sortCalcRange(false)">{{ $t('editor.toolbar.calcSortDesc') }}</text>
                <text class="etb-pg-chip" :class="{ on: calcState.autoFilter }" @tap.stop="toggleCalcAutoFilter">{{ $t('editor.toolbar.calcAutoFilter') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcValidationSection') }}</text>
              <view class="etb-seg">
                <text class="etb-seg-b" :class="{ on: calcValForm.type === 'list' }" @tap.stop="calcValForm.type = 'list'">{{ $t('editor.toolbar.calcValList') }}</text>
                <text class="etb-seg-b" :class="{ on: calcValForm.type === 'whole' }" @tap.stop="calcValForm.type = 'whole'">{{ $t('editor.toolbar.calcValWhole') }}</text>
                <text class="etb-seg-b" :class="{ on: calcValForm.type === 'decimal' }" @tap.stop="calcValForm.type = 'decimal'">{{ $t('editor.toolbar.calcValDecimal') }}</text>
              </view>
              <input v-if="calcValForm.type === 'list'" class="etb-input" v-model="calcValForm.list" :placeholder="$t('editor.toolbar.calcValListPh')" @click.stop />
              <view v-else class="etb-margin-grid">
                <input class="etb-input" type="digit" v-model="calcValForm.min" :placeholder="$t('editor.toolbar.calcValMinPh')" @click.stop />
                <input class="etb-input" type="digit" v-model="calcValForm.max" :placeholder="$t('editor.toolbar.calcValMaxPh')" @click.stop />
              </view>
              <view class="etb-form-acts">
                <text class="etb-form-b sm" @tap.stop="clearCalcValidation">{{ $t('editor.toolbar.calcValClear') }}</text>
                <text class="etb-form-b ok sm" @tap.stop="applyCalcValidation">{{ $t('editor.toolbar.calcValApply') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcCondGroupSection') }}</text>
              <view class="etb-inline-row">
                <view class="etb-seg">
                  <text class="etb-seg-b" :class="{ on: calcCondForm.operator === '>' }" @tap.stop="calcCondForm.operator = '>'">&gt;</text>
                  <text class="etb-seg-b" :class="{ on: calcCondForm.operator === '<' }" @tap.stop="calcCondForm.operator = '<'">&lt;</text>
                  <text class="etb-seg-b" :class="{ on: calcCondForm.operator === '=' }" @tap.stop="calcCondForm.operator = '='">=</text>
                </view>
                <input class="etb-input" v-model="calcCondForm.value1" :placeholder="$t('editor.toolbar.calcCondValPh')" @click.stop />
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="applyCalcCondFormat('#FDE8E8', '#9B1C1C')">{{ $t('editor.toolbar.calcCondRed') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcCondFormat('#FEF3C7', '#92400E')">{{ $t('editor.toolbar.calcCondYellow') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyCalcCondFormat('#DEF7EC', '#03543F')">{{ $t('editor.toolbar.calcCondGreen') }}</text>
                <text class="etb-pg-chip" @tap.stop="clearCalcCondFormat">{{ $t('editor.toolbar.calcCondClear') }}</text>
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="groupCalcRowsCols('group', 'rows')">{{ $t('editor.toolbar.calcGroupRows') }}</text>
                <text class="etb-pg-chip" @tap.stop="groupCalcRowsCols('ungroup', 'rows')">{{ $t('editor.toolbar.calcUngroupRows') }}</text>
                <text class="etb-pg-chip" @tap.stop="groupCalcRowsCols('group', 'columns')">{{ $t('editor.toolbar.calcGroupCols') }}</text>
                <text class="etb-pg-chip" @tap.stop="groupCalcRowsCols('ungroup', 'columns')">{{ $t('editor.toolbar.calcUngroupCols') }}</text>
              </view>
              <text v-if="calcErr" class="etb-err">{{ calcErr }}</text>
            </view>
          </view>

          <!-- 插入 ⌄ (Calc: 图表 / 批注 / 命名区域 / 透视表 / 图片) -->
          <view class="etb-drop" :class="{ open: menu === 'calcInsert' }">
            <view ref="trig_calcInsert" class="etb-field w72" :class="{ on: menu === 'calcInsert' }" :title="$t('editor.toolbar.calcInsertTitle')" @tap.stop="openCalcMenu('calcInsert')">
              <text class="etb-field-t">{{ $t('editor.toolbar.insert') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'calcInsert'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.calcInsertTitle') }}</text>
                <text class="etb-pg-chip" @tap.stop="pickImage">{{ $t('editor.toolbar.insertImage') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcChartSection') }}</text>
              <view class="etb-pg-chips">
                <text v-for="ct in CALC_CHART_TYPES" :key="ct.k" class="etb-pg-chip" :class="{ on: calcChartForm.type === ct.k }" @tap.stop="calcChartForm.type = ct.k">{{ $t('editor.toolbar.' + ct.label) }}</text>
              </view>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcChartForm.range" :placeholder="$t('editor.toolbar.calcChartRange')" @click.stop />
                <input class="etb-input" v-model="calcChartForm.title" :placeholder="$t('editor.toolbar.calcChartTitlePh')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="insertCalcChart">{{ $t('editor.toolbar.calcChartInsert') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcCommentSection') }}</text>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcCommentText" :placeholder="$t('editor.toolbar.commentPlaceholder')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="saveCalcComment">{{ $t('editor.toolbar.calcCommentAdd') }}</text>
                <text class="etb-form-b sm" @tap.stop="deleteCalcComment">{{ $t('editor.toolbar.calcCommentDel') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcNameSection') }}</text>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcNameForm.name" :placeholder="$t('editor.toolbar.calcNamePh')" @click.stop />
                <input class="etb-input" v-model="calcNameForm.range" :placeholder="$t('editor.toolbar.calcNameRangePh')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="defineCalcName">{{ $t('editor.toolbar.calcNameAdd') }}</text>
              </view>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcPivotForm.rowField" :placeholder="$t('editor.toolbar.calcPivotRowPh')" @click.stop />
                <input class="etb-input" v-model="calcPivotForm.dataField" :placeholder="$t('editor.toolbar.calcPivotDataPh')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="insertCalcPivot">{{ $t('editor.toolbar.calcPivotInsert') }}</text>
              </view>
              <text v-if="calcErr" class="etb-err">{{ calcErr }}</text>
            </view>
          </view>

          <!-- 工作表与视图 ⌄ (ElyOffice sheets.rs & page.rs) -->
          <view class="etb-drop" :class="{ open: menu === 'calcSheet' }">
            <view ref="trig_calcSheet" class="etb-field w110" :class="{ on: menu === 'calcSheet' }" :title="$t('editor.toolbar.calcSheetTitle')" @tap.stop="openCalcMenu('calcSheet')">
              <text class="etb-field-t">{{ $t('editor.toolbar.calcSheetGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'calcSheet'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.calcSheetTitle') }}</text>
                <text class="etb-pg-chip ok" @tap.stop="addCalcSheet">{{ $t('editor.toolbar.calcSheetAdd') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcFreezeSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="freezeCalcPanes(0, 1)">{{ $t('editor.toolbar.calcFreezeTopRow') }}</text>
                <text class="etb-pg-chip" @tap.stop="freezeCalcPanes(1, 0)">{{ $t('editor.toolbar.calcFreezeFirstCol') }}</text>
                <text class="etb-pg-chip" @tap.stop="freezeCalcAtCurrent">{{ $t('editor.toolbar.calcFreezeCurrent') }}</text>
                <text class="etb-pg-chip" @tap.stop="freezeCalcPanes(0, 0)">{{ $t('editor.toolbar.calcFreezeNone') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcSheetListSection') }}</text>
              <view class="etb-pg-chips">
                <text v-for="sh in (calcState.sheets || [])" :key="sh" class="etb-pg-chip" :class="{ on: sh === calcState.sheet }" @tap.stop="switchCalcSheet(sh)">{{ sh }}</text>
              </view>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="calcRenameText" :placeholder="$t('editor.toolbar.calcSheetRenamePh')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="renameCalcSheet">{{ $t('editor.toolbar.calcSheetRename') }}</text>
                <text v-if="(calcState.sheets || []).length > 1" class="etb-form-b sm danger" @tap.stop="deleteCalcSheet">{{ $t('editor.toolbar.calcSheetDelete') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.calcSheetProtectSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" :class="{ on: calcState.protected }" @tap.stop="toggleCalcProtect">{{ calcState.protected ? $t('editor.toolbar.calcUnprotectSheet') : $t('editor.toolbar.calcProtectSheet') }}</text>
                <text class="etb-pg-chip" :class="{ on: state.view && state.view.showGrid !== false }" @tap.stop="toggleCalcGridlines">{{ $t('editor.toolbar.calcGridlines') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyPageOrientation('portrait')">{{ $t('editor.toolbar.portrait') }}</text>
                <text class="etb-pg-chip" @tap.stop="applyPageOrientation('landscape')">{{ $t('editor.toolbar.landscape') }}</text>
              </view>
              <text v-if="calcErr" class="etb-err">{{ calcErr }}</text>
            </view>
          </view>
        </template>

        <!-- PPT (impress) 专有插入、形状、表格与备注卡片 (apps/ely-slides/src/tabs/*.rs) -->
        <template v-if="isImpress">
          <!-- 插入 ⌄ (Impress: 文本框 / 形状 / 表格 / 图片 / 超链接) -->
          <view class="etb-drop" :class="{ open: menu === 'impressInsert' }">
            <view ref="trig_impressInsert" class="etb-field w72" :class="{ on: menu === 'impressInsert' }" :title="$t('editor.toolbar.impressInsertTitle')" @tap.stop="openImpressMenu('impressInsert')">
              <text class="etb-field-t">{{ $t('editor.toolbar.insert') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'impressInsert'" class="etb-menu w280 pad etb-prop-card" :style="popStyle(280, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.impressInsertTitle') }}</text>
                <text class="etb-pg-chip ok" @tap.stop="insertImpressTextBox">{{ $t('editor.toolbar.impressTextBox') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressShapesSection') }}</text>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="insertImpressShape('rectangle')">{{ $t('editor.toolbar.impressShapeRect') }}</text>
                <text class="etb-pg-chip" @tap.stop="insertImpressShape('ellipse')">{{ $t('editor.toolbar.impressShapeEllipse') }}</text>
                <text class="etb-pg-chip" @tap.stop="insertImpressShape('triangle')">{{ $t('editor.toolbar.impressShapeTriangle') }}</text>
                <text class="etb-pg-chip" @tap.stop="insertImpressShape('line')">{{ $t('editor.toolbar.impressShapeLine') }}</text>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ grid.r ? $t('editor.toolbar.gridSize', { rows: grid.r, cols: grid.c }) : $t('editor.toolbar.insertTable') }}</text>
              <view class="etb-grid">
                <view v-for="cell in GRID_CELLS" :key="'imp-' + cell.k" class="etb-cell"
                      :class="{ hot: cell.r <= grid.r && cell.c <= grid.c }"
                      @mouseenter="grid = { r: cell.r, c: cell.c }" @tap.stop="insertImpressTable(cell.r, cell.c)"></view>
              </view>
              <view class="etb-menu-sep"></view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="pickImage">{{ $t('editor.toolbar.insertImage') }}</text>
              </view>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="linkUrl" :placeholder="$t('editor.toolbar.linkPlaceholder')" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="applyImpressHyperlink">{{ $t('editor.toolbar.insertLink') }}</text>
              </view>
              <text v-if="impressErr" class="etb-err">{{ impressErr }}</text>
            </view>
          </view>

          <!-- 形状与排列 ⌄ (ElyOffice object.rs Position & Size + Appearance) -->
          <view class="etb-drop" :class="{ open: menu === 'impressShape' }">
            <view ref="trig_impressShape" class="etb-field w96" :class="{ on: menu === 'impressShape' }" :title="$t('editor.toolbar.impressShapeTitle')" @tap.stop="openImpressMenu('impressShape')">
              <text class="etb-field-t">{{ $t('editor.toolbar.impressShapeGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'impressShape'" class="etb-menu w320 pad etb-prop-card" :style="popStyle(320, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.impressShapeTitle') }}</text>
                <text v-if="(impressState.shapes || []).length > 0" class="etb-pg-chip danger" @tap.stop="deleteImpressShape">{{ $t('editor.toolbar.impressDeleteShape') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressTargetShape') }}</text>
              <view v-if="(impressState.shapes || []).length > 0" class="etb-pg-chips">
                <text v-for="sh in impressState.shapes" :key="sh.index" class="etb-pg-chip" :class="{ on: activeShapeIndex === sh.index }" @tap.stop="selectImpressShapeTarget(sh)">
                  #{{ sh.index }} {{ sh.name || (sh.text ? sh.text.slice(0, 8) : sh.type) }}
                </text>
              </view>
              <text v-else class="etb-hint">{{ $t('editor.toolbar.impressNoShapes') }}</text>
              <template v-if="(impressState.shapes || []).length > 0">
                <text class="etb-pg-sec">{{ $t('editor.toolbar.impressShapeTextSection') }}</text>
                <view class="etb-inline-row">
                  <input class="etb-input" v-model="impressShapeTextInput" :placeholder="$t('editor.toolbar.impressShapeTextPh')"
                         @focus="impressShapeTextFocused = true" @blur="impressShapeTextFocused = false"
                         @confirm="updateImpressShapeText" @click.stop />
                  <text class="etb-form-b ok sm" @tap.stop="updateImpressShapeText">{{ $t('editor.toolbar.impressShapeTextApply') }}</text>
                </view>
              </template>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressFillSection') }}</text>
              <view class="etb-pg-swatches">
                <view v-for="c in SHAPE_SWATCHES" :key="'sf-' + c" class="etb-chip" :style="{ background: c }" @tap.stop="formatImpressShape({ fillColor: c })"></view>
                <text class="etb-pg-chip" @tap.stop="formatImpressShape({ noFill: true })">{{ $t('editor.toolbar.impressNoFill') }}</text>
                <text v-for="tr in [0, 20, 50, 80]" :key="'tr-' + tr" class="etb-pg-chip" @tap.stop="formatImpressShape({ fillTransparency: tr })">{{ tr }}%</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressLineSection') }}</text>
              <view class="etb-pg-swatches">
                <view v-for="c in SHAPE_SWATCHES" :key="'sl-' + c" class="etb-chip" :style="{ background: c }" @tap.stop="formatImpressShape({ lineColor: c })"></view>
                <text class="etb-pg-chip" @tap.stop="formatImpressShape({ noLine: true })">{{ $t('editor.toolbar.impressNoLine') }}</text>
                <text v-for="lw in [0.75, 1.5, 2.25, 3]" :key="'lw-' + lw" class="etb-pg-chip" @tap.stop="formatImpressShape({ lineWidthPt: lw })">{{ lw }}pt</text>
              </view>
              <view class="etb-menu-sep"></view>
              <view class="etb-pg-subhead">
                <text class="etb-pg-sec">{{ $t('editor.toolbar.impressGeomSection') }}</text>
                <text class="etb-form-b ok sm" @tap.stop="applyImpressShapeGeom">{{ $t('editor.toolbar.impressApplyGeom') }}</text>
              </view>
              <view class="etb-margin-grid">
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressGeomX') }}</text>
                  <input class="etb-num" type="digit" v-model="shapeGeomForm.left" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressGeomY') }}</text>
                  <input class="etb-num" type="digit" v-model="shapeGeomForm.top" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressGeomW') }}</text>
                  <input class="etb-num" type="digit" v-model="shapeGeomForm.width" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressGeomH') }}</text>
                  <input class="etb-num" type="digit" v-model="shapeGeomForm.height" @click.stop />
                </view>
              </view>
              <text v-if="impressErr" class="etb-err">{{ impressErr }}</text>
            </view>
          </view>

          <!-- 表格样式 ⌄ (ElyOffice table.rs: 当幻灯片含有表格对象或光标在表内时展示) -->
          <view v-if="impressHasTable" class="etb-drop" :class="{ open: menu === 'impressTable' }">
            <view ref="trig_impressTable" class="etb-field w84" :class="{ on: menu === 'impressTable' }" :title="$t('editor.toolbar.impressTableTitle')" @tap.stop="openImpressMenu('impressTable')">
              <text class="etb-field-t">{{ $t('editor.toolbar.impressTableGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'impressTable'" class="etb-menu w280 pad etb-prop-card" :style="popStyle(280, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.impressTableTitle') }}</text>
              </view>
              <view class="etb-pg-chips">
                <text class="etb-pg-chip" @tap.stop="styleImpressTable({ headerBold: true })">{{ $t('editor.toolbar.impressTableHeaderBold') }}</text>
                <text class="etb-pg-chip" @tap.stop="styleImpressTable({ borderColor: '#CBD5E1', borderWidthPt: 1 })">{{ $t('editor.toolbar.impressTableBorderThin') }}</text>
                <text class="etb-pg-chip" @tap.stop="styleImpressTable({ borderColor: '#475569', borderWidthPt: 1.5 })">{{ $t('editor.toolbar.impressTableBorderThick') }}</text>
              </view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.tableHeaderFill') }}</text>
              <view class="etb-pg-swatches">
                <view v-for="c in TABLE_FILL_SWATCHES.filter(x => x !== 'none')" :key="'itf-' + c" class="etb-chip" :style="{ background: c }" @tap.stop="styleImpressTable({ headerFill: c, headerBold: true })"></view>
              </view>
              <view class="etb-menu-sep"></view>
              <text class="etb-pg-sec">{{ $t('editor.toolbar.impressTableCellSection') }}</text>
              <view class="etb-margin-grid">
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressTableCellRow') }}</text>
                  <input class="etb-num" type="number" v-model="impressTableCellForm.row" @click.stop />
                </view>
                <view class="etb-margin-cell">
                  <text class="etb-pg-u">{{ $t('editor.toolbar.impressTableCellCol') }}</text>
                  <input class="etb-num" type="number" v-model="impressTableCellForm.col" @click.stop />
                </view>
              </view>
              <view class="etb-inline-row">
                <input class="etb-input" v-model="impressTableCellForm.text" :placeholder="$t('editor.toolbar.impressTableCellTextPh')" @confirm="setImpressTableCell" @click.stop />
                <text class="etb-form-b ok sm" @tap.stop="setImpressTableCell">{{ $t('editor.toolbar.impressTableCellWrite') }}</text>
              </view>
              <text v-if="impressErr" class="etb-err">{{ impressErr }}</text>
            </view>
          </view>

          <!-- 演讲者备注 ⌄ (ElyOffice notes.rs) -->
          <view class="etb-drop" :class="{ open: menu === 'impressNotes' }">
            <view ref="trig_impressNotes" class="etb-field w72" :class="{ on: menu === 'impressNotes' || !!(impressState.notesText && impressState.notesText.trim()) }" :title="$t('editor.toolbar.impressNotesTitle')" @tap.stop="openImpressMenu('impressNotes')">
              <text class="etb-field-t">{{ $t('editor.toolbar.impressNotesGroup') }}</text>
              <text class="etb-caret">⌄</text>
            </view>
            <view v-if="menu === 'impressNotes'" class="etb-menu w280 pad etb-prop-card" :style="popStyle(280, true)" @tap.stop>
              <view class="etb-pg-head">
                <text class="etb-pg-title">{{ $t('editor.toolbar.impressNotesTitle') }}</text>
                <text class="etb-form-b ok sm" @tap.stop="saveImpressNotes">{{ $t('editor.toolbar.impressNotesSave') }}</text>
              </view>
              <textarea class="etb-input ta" v-model="impressNotesInput" :placeholder="$t('editor.toolbar.impressNotesPh')" @focus="impressNotesFocused = true" @blur="impressNotesFocused = false" @click.stop />
              <text v-if="impressErr" class="etb-err">{{ impressErr }}</text>
            </view>
          </view>
        </template>
      </view>
    </scroll-view>
    <!-- 两端渐隐提示：主命令区还能往左/右滚时露出，遮罩不接收点击（
         BUG-13：1400 宽下对齐/列表/缩进/插入/¶/表格组全被滚出视口却没有任何提示）。
         有没有滚动余量由 bindToolbarWheel 里挂的原生 scroll/resize 监听实时量，
         不能反过来靠这两块遮罩自己猜。 -->
    <view v-if="canScrollLeft" class="etb-fade etb-fade-l"></view>
    <view v-if="canScrollRight" class="etb-fade etb-fade-r"></view>
    </view>

    <!-- 右侧常驻区：不参与滚动 -->
    <view class="etb-right">
      <view class="etb-btn wide" :class="{ on: findOpen }" :title="$t('editor.toolbar.findAndReplace')" @tap.stop="toggleFind">
        <text class="etb-tx sm">{{ $t('editor.toolbar.find') }}</text>
      </view>
      <view v-if="isWriter" class="etb-btn wide" :class="{ on: state.view.recordChanges }" :title="$t('editor.toolbar.trackChanges')" @tap.stop="toggleTrack">
        <text class="etb-tx sm">{{ $t('editor.toolbar.trackChangesShort') }}</text>
      </view>
      <!-- 修订显示方式三态（dev-board#368）与 #66 PR-B 黄金路径「接受/拒绝当前 + 全部」
           折入同一张 PropertyGroup 卡片，让右侧常驻区干净收拢。当前态取自 get_ui_state
           的真实读回；引擎不支持页边显示时中间项自动消失（退成两态）。 -->
      <view v-if="isWriter && state.view.revisionView" class="etb-drop" :class="{ open: menu === 'revview' }">
        <view ref="trig_revview" class="etb-field w96" :class="{ on: menu === 'revview' }" :title="$t('editor.toolbar.revisionView')" @tap.stop="toggleMenu('revview')">
          <text class="etb-field-t">{{ revisionViewLabel }}</text>
          <text class="etb-caret">⌄</text>
        </view>
        <view v-if="menu === 'revview'" class="etb-menu w200 pad etb-prop-card" :style="popStyle(200)" @tap.stop>
          <text class="etb-pg-sec">{{ $t('editor.toolbar.revisionView') }}</text>
          <view v-for="o in revisionViewOptions" :key="o.k" class="etb-item"
                :class="{ on: o.k === state.view.revisionView }" @tap.stop="pickRevisionView(o.k)">
            <text class="etb-item-t">{{ $t('editor.toolbar.' + o.t) }}</text>
          </view>
          <view class="etb-menu-sep"></view>
          <text class="etb-pg-sec">{{ $t('editor.toolbar.revisionResolveSection') }}</text>
          <view class="etb-pg-acts">
            <view class="etb-btn wide" :class="{ off: resolvingRevision }" :title="$t('editor.toolbar.acceptCurrent')" @tap.stop="resolveAtCursor('accept')">
              <text class="etb-tx sm">{{ $t('editor.toolbar.acceptCurrentShort') }}</text>
            </view>
            <view class="etb-btn wide" :class="{ off: resolvingRevision }" :title="$t('editor.toolbar.rejectCurrent')" @tap.stop="resolveAtCursor('reject')">
              <text class="etb-tx sm">{{ $t('editor.toolbar.rejectCurrentShort') }}</text>
            </view>
            <view class="etb-btn wide" :class="{ off: resolvingRevision }" :title="$t('editor.toolbar.acceptAll')" @tap.stop="resolveAllRevisions('accept')">
              <text class="etb-tx sm">{{ $t('editor.toolbar.acceptAllShort') }}</text>
            </view>
            <view class="etb-btn wide" :class="{ off: resolvingRevision }" :title="$t('editor.toolbar.rejectAll')" @tap.stop="resolveAllRevisions('reject')">
              <text class="etb-tx sm">{{ $t('editor.toolbar.rejectAllShort') }}</text>
            </view>
          </view>
        </view>
      </view>
      <view v-if="isWriter" class="etb-btn wide" :class="{ on: reviewOpen }" :title="$t('editor.toolbar.reviewPanel')" @tap.stop="$emit('toggle-review')">
        <text class="etb-tx sm">{{ $t('editor.toolbar.reviewShort') }}</text>
      </view>
      <!-- 「审校」按钮已随 dev-board#749 撤掉：开关归正文那颗浮球（开关必须和它
           控制的东西待在一起），工具栏这里只留「审阅」。 -->
      <view v-if="isWriter" class="etb-btn wide" :title="$t('editor.visualReview.title')" @tap.stop="$emit('visual-review')">
        <text class="etb-tx sm">{{ $t('editor.visualReview.title') }}</text>
      </view>
      <!-- 写作一组：「有据续写」（dev-board#748）与「自动补全」（dev-board#755）。
           两块面板本体都长在客体页里（要跟着正文光标走），这里是它们的唯一入口：
           点一下给客体发开合指令，按下态等客体回报，宿主不本地乐观翻。
           客体报不可用（非 Writer / 只读 / 换文档重起）时那颗按钮整个不出现；
           两颗都不可用时连这条分隔线也不画，免得工具栏末尾挂一根孤线。 -->
      <view v-if="semanticWritingAvailable || writingAssistanceAvailable" class="etb-sep"></view>
      <view v-if="semanticWritingAvailable" class="etb-btn wide" :class="{ on: semanticWritingOn }"
            :title="$t('editor.toolbar.semanticWriting')" @tap.stop="$emit('toggle-semantic-writing')">
        <text class="etb-tx sm">{{ $t('editor.toolbar.semanticWritingShort') }}</text>
      </view>
      <view v-if="writingAssistanceAvailable" class="etb-btn wide" :class="{ on: writingAssistanceOn }"
            :title="$t('editor.toolbar.autocomplete')" @tap.stop="$emit('toggle-writing-assistance')">
        <text class="etb-tx sm">{{ $t('editor.toolbar.autocompleteShort') }}</text>
      </view>
      <view class="etb-stepper" :title="$t('editor.toolbar.zoom')">
        <text class="etb-step-b" @tap.stop="stepZoom(-10)">−</text>
        <text class="etb-step-v z" @tap.stop="resetZoom">{{ Math.round(state.view.zoom || 100) }}%</text>
        <text class="etb-step-b" @tap.stop="stepZoom(10)">+</text>
      </view>
    </view>
  </view>

  <!-- Excel (calc) 专属名称框、工作表标签栏、公式栏与快捷函数（ElyOffice apps/ely-table/src/bars.rs） -->
  <view v-if="isCalc" class="etb-calc-bar" @tap="closeMenus">
    <view class="etb-calc-sheet-tabs">
      <text v-for="sh in calcSheetsList" :key="sh" class="etb-calc-sheet-tab"
            :class="{ on: sh === (calcState.sheet || 'Sheet1') }"
            @tap.stop="switchCalcSheet(sh)">{{ sh }}</text>
    </view>
    <text class="etb-calc-sheet-add" :title="$t('editor.toolbar.calcSheetAdd')" @tap.stop="addCalcSheet">+</text>
    <view class="etb-calc-sheet-pill" :title="$t('editor.toolbar.calcSheetTitle')" @tap.stop="openCalcMenu('calcSheet')">
      <text class="etb-caret">⌄</text>
    </view>
    <view class="etb-sep"></view>
    <input class="etb-calc-name-box" v-model="calcAddressInput" :title="$t('editor.toolbar.calcNameBoxTitle')"
           @focus="calcAddressFocused = true" @blur="calcAddressFocused = false"
           @confirm="submitCalcAddress" @keydown.enter.prevent="submitCalcAddress" />
    <text class="etb-calc-fx">fx</text>
    <text class="etb-calc-fx-btn ok" :title="$t('editor.toolbar.apply')" @tap.stop="submitCalcFormula">✓</text>
    <text class="etb-calc-fx-btn" :title="$t('editor.toolbar.cancel')" @tap.stop="cancelCalcFormula">✕</text>
    <input class="etb-calc-formula-input" v-model="calcFormulaInput" :placeholder="$t('editor.toolbar.calcFormulaPh')"
           @focus="calcFormulaFocused = true" @blur="calcFormulaFocused = false"
           @confirm="submitCalcFormula" @keydown.enter.prevent="submitCalcFormula" @keydown.esc.prevent="cancelCalcFormula" />
    <view class="etb-calc-fn-chips">
      <text v-for="fn in CALC_QUICK_FNS" :key="fn.fn" class="etb-calc-fn-chip"
            :title="$t('editor.toolbar.' + fn.label) + ' (' + fn.fn + ')'"
            @tap.stop="insertCalcQuickFormula(fn.fn)">{{ $t('editor.toolbar.' + fn.label) }}</text>
    </view>
  </view>

  <!-- 查找替换：自建面板，不走 LO 的 .uno:SearchDialog——真机审计实证那个对话框
       弹得出来但**键盘关不掉**（画布聚焦时按 Esc 同样无效），挂上去就是个坑。
       **绝对定位浮在画布上，不占布局高度**（dev-board#503）：这一条留在文档流里
       时，开关查找会让工具栏一高一矮，下面的 <webview> 跟着改尺寸，Electron 的
       客体合成面在新尺寸那一帧到达前被整块画成黑色——用户看到的就是"点查找整个
       编辑区黑一下"。给画布容器或 webview 元素铺底色都拦不住（客体面盖在上面，
       真机探针实测过）；唯一有效的是根本不改 webview 尺寸。
       钉法与 EvidenceStaleBar/状态胶囊同规矩（浮在画布上，不进流）。 -->
  <view v-if="findOpen" class="etb-find-layer">
  <view class="etb-find">
    <input class="etb-input fi" v-model="findText" :placeholder="$t('editor.toolbar.findPlaceholder')" @input="onFindInput" @confirm="findNext" />
    <text class="etb-find-n">{{ findStatus }}</text>
    <text class="etb-find-b" :title="$t('editor.toolbar.prevMatch')" @tap.stop="findPrev">{{ $t('editor.toolbar.prevMatch') }}</text>
    <text class="etb-find-b" :title="$t('editor.toolbar.nextMatch')" @tap.stop="findNext">{{ $t('editor.toolbar.nextMatch') }}</text>
    <input class="etb-input fi" v-model="replaceText" :placeholder="$t('editor.toolbar.replacePlaceholder')" />
    <text class="etb-find-b" @tap.stop="replaceCurrent">{{ $t('editor.toolbar.replace') }}</text>
    <text class="etb-find-b" @tap.stop="replaceAll">{{ $t('editor.toolbar.replaceAll') }}</text>
    <text class="etb-find-b" :class="{ on: matchCase }" :title="$t('editor.toolbar.matchCase')" @tap.stop="toggleCase">Aa</text>
    <text class="etb-find-x" @tap.stop="toggleFind">{{ $t('editor.toolbar.close') }}</text>
  </view>
  <text v-if="findErr" class="etb-err bar">{{ findErr }}</text>
  </view>
  <SystemFontsPanel v-if="systemFontsOpen" :visible="systemFontsOpen" @close="systemFontsOpen = false" @saved="onSystemFontsSaved" />
  </view>
</template>

<script>
// EditorToolbar.vue — 自建编辑器工具栏（P2）。
//
// WHY: LibreOffice 自己画的菜单栏/工具栏是引擎渲染在 canvas 上的，观感老旧，
// 菜单栏末端还挂着一个会把文档关掉的 ×。方案定的最终形态是自建工具栏，LO 的
// chrome 退场（docs/superpowers/specs/2026-08-14-editor-chrome-self-built-toolbar.md）。
//
// 本阶段（P2a）**只加不减**：工具栏挂上去，LO chrome 原样保留。用户可以两套并存
// 地用，功能覆盖到位了再谈隐藏——「体验不能退步」是硬约束，不能先砍后补。
//
// 每个按钮都落到 worker 的一个 action 上（P1 命令层）：
//   ui_command（.uno: 白名单）/ format_selection / set_style / set_zoom /
//   set_track_changes / undo / redo。
// **不放做不到的按钮**：`.uno:Grow`/`.uno:Shrink` 在本引擎是哑弹（派发成功但
// 字号纹丝不动），所以字号步进是读回当前值再写 fontSize，不是派发那两个槽。
//
// 激活态刷新（get_ui_state，实测 ~6ms）由三路信号驱动，见 refreshKey：
//   1) worker 的 XSelectionChangeListener（选区类变化）
//   2) IME 覆盖层的 onCursorMoved（纯光标移动/画布点击——上面那条盖不住）
//   3) 本组件自己发完命令之后
// 没有轮询：以上三路已经覆盖了用户能让光标动起来的所有途径。

import { bindHorizontalWheel } from '@/utils/horizontalWheel.js'
import { watchScrollEdges } from '@/utils/scrollEdges.js'
import { isEnglish } from '@/utils/appLanguage.js'
import { host } from '@/services/host.js'
import { CN_FONT_SIZES, PT_FONT_SIZES } from '@/utils/paragraphFormat.js'
import ParagraphFormatPanel from './ParagraphFormatPanel.vue'
import SystemFontsPanel from './SystemFontsPanel.vue'

const ICONS = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  marker: ['M4 20h5', 'M9 16l-3 4', 'M12.5 4.5l7 7-6 6-7-7z', 'M10 17l-3 3'],
  clear: ['M6 5h13', 'M9 5l6 14', 'M4 19h7'],
  alignLeft: ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h10'],
  alignCenter: ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
  alignRight: ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M10 18h10'],
  alignJustify: ['M4 6h16', 'M4 10h16', 'M4 14h16', 'M4 18h16'],
  bullet: ['M9 6h11', 'M9 12h11', 'M9 18h11', 'M4.5 6h.01', 'M4.5 12h.01', 'M4.5 18h.01'],
  number: ['M10 6h10', 'M10 12h10', 'M10 18h10', 'M4 5h1v4', 'M4 9h2', 'M4 15h2v2H4v2h2'],
  indent: ['M4 6h16', 'M10 10h10', 'M10 14h10', 'M4 18h16', 'M4 10l3 2-3 2'],
  outdent: ['M4 6h16', 'M10 10h10', 'M10 14h10', 'M4 18h16', 'M7 10l-3 2 3 2'],
  pagebreak: ['M6 4h12', 'M6 20h12', 'M3 12h4', 'M10 12h4', 'M17 12h4'],
  rowAbove: ['M4 13h16v7H4z', 'M12 3v7', 'M9 6l3-3 3 3'],
  rowBelow: ['M4 4h16v7H4z', 'M12 21v-7', 'M9 18l3 3 3-3'],
  colLeft: ['M13 4h7v16h-7z', 'M3 12h7', 'M6 9l-3 3 3 3'],
  colRight: ['M4 4h7v16H4z', 'M21 12h-7', 'M18 9l3 3-3 3'],
  delRow: ['M4 9h16v6H4z', 'M9 5l6 14'],
  delCol: ['M9 4h6v16H9z', 'M5 9l14 6'],
  ruler: ['M3 8h18v8H3z', 'M7 8v3', 'M11 8v4', 'M15 8v3', 'M19 8v4'],
}
const ALIGNS = [
  { k: 'left', cmd: 'align_left', t: 'alignLeft', icon: 'alignLeft' },
  { k: 'center', cmd: 'align_center', t: 'alignCenter', icon: 'alignCenter' },
  { k: 'right', cmd: 'align_right', t: 'alignRight', icon: 'alignRight' },
  { k: 'justify', cmd: 'align_justify', t: 'alignJustify', icon: 'alignJustify' },
]
const TEXT_COLORS = [
  { v: 'auto', t: 'auto' }, { v: '#C0392B', t: 'red' }, { v: '#2E5A50', t: 'ink' },
  { v: '#1D4ED8', t: 'blue' }, { v: '#B45309', t: 'brown' }, { v: '#6B21A8', t: 'purple' },
  { v: '#495057', t: 'darkGray' }, { v: '#868E96', t: 'gray' },
]
const HL_COLORS = [
  { v: 'none', t: 'none' }, { v: 'yellow', t: 'yellow' }, { v: 'green', t: 'green' },
  { v: 'cyan', t: 'cyan' }, { v: 'magenta', t: 'magenta' }, { v: 'gray', t: 'gray' },
]
// 样式下拉只列律师真会用的这些（126 条全塞进去没人找得到）；当前段落用的样式
// 若不在表里也会被补进列表，不至于「显示的样式选不回来」。
const STYLE_PICKS = [
  'Standard', 'Text body', 'Title', 'Subtitle',
  'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4',
  'Quotations', 'List', 'Caption', 'First line indent',
]
// 脚注/尾注/页眉/页脚共用一个单行文本表单：只差调哪个原语、用哪句提示。
// 注意：**没有尾注**。本引擎构建不支持——insert_endnote 设 IsEndnote 时抛
// IllegalArgumentException（真机实证）。做不到的不放按钮。
const TEXT_FORMS = {
  footnote: { title: 'footnoteTitle', ph: 'footnotePlaceholder', action: 'insert_footnote', arg: 'text' },
  header: { title: 'headerTitle', ph: 'headerPlaceholder', action: 'edit_header_footer', arg: 'text', extra: { target: 'header' } },
  footer: { title: 'footerTitle', ph: 'footerPlaceholder', action: 'edit_header_footer', arg: 'text', extra: { target: 'footer' } },
}
// 用户选择正文内修订、纸外批注框或最终稿；旧 native margin 仅供内部兼容。
const REVISION_VIEWS = [
  { k: 'all', t: 'revisionViewAll' },
  { k: 'balloons', t: 'revisionViewMargin' },
  { k: 'final', t: 'revisionViewFinal' },
]
const SIZES = PT_FONT_SIZES
// 沿用原总开关偏好；未保存分类时四类均开启，升级不会擅自覆盖旧选择。
// 引擎换文档后会重置视图，因此 bootstrap / reapplyChrome 都重新应用。
const MARK_OPTIONS = [
  { key: 'paragraphMarks', label: 'paragraphMarks' },
  { key: 'lineBreaks', label: 'lineBreaks' },
  { key: 'spaces', label: 'spaces' },
  { key: 'tabs', label: 'tabs' },
]
const MARK_DEFAULTS = Object.fromEntries(MARK_OPTIONS.map(o => [o.key, true]))
const VIEW_PREFS_KEY = 'awd_editor_view_prefs'
const VIEW_PREFS_HOSTS = new Set()
let viewPrefsUpdate = Promise.resolve()
const VIEW_PREFS_DEFAULT = { formattingMarks: true, ruler: true, ...MARK_DEFAULTS }
function readViewPrefs() {
  try {
    const v = uni.getStorageSync(VIEW_PREFS_KEY)
    const o = typeof v === 'string' && v ? JSON.parse(v) : (v && typeof v === 'object' ? v : {})
    return Object.assign({}, VIEW_PREFS_DEFAULT, o)
  } catch (e) { return Object.assign({}, VIEW_PREFS_DEFAULT) }
}
function writeViewPrefs(p) { uni.setStorageSync(VIEW_PREFS_KEY, JSON.stringify(p)) }
// 插入表格的网格选择器：8 行 × 8 列够覆盖手工建表的绝大多数情形，再大的表
// 律师是从 Excel 粘过来或让 AI 生成的，不是在这里点出来的。
const GRID_R = 8, GRID_C = 8
const GRID_CELLS = []
for (let r = 1; r <= GRID_R; r++) for (let c = 1; c <= GRID_C; c++) GRID_CELLS.push({ r, c, k: r + '-' + c })

// ElyOffice PropertyGroup 页面/目录/页码/表格预设常量
const PAPER_SIZES = [
  { k: 'A4', label: 'A4', width: 210, height: 297 },
  { k: 'A3', label: 'A3', width: 297, height: 420 },
  { k: 'A5', label: 'A5', width: 148, height: 210 },
  { k: 'B5', label: 'B5', width: 176, height: 250 },
  { k: 'Letter', label: 'Letter', width: 215.9, height: 279.4 },
  { k: 'Legal', label: 'Legal', width: 215.9, height: 355.6 },
]
const MARGIN_PRESETS = [
  { k: 'normal', top: 2.54, bottom: 2.54, left: 3.18, right: 3.18 },
  { k: 'official', top: 3.7, bottom: 3.5, left: 2.8, right: 2.6 },
  { k: 'narrow', top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 },
  { k: 'moderate', top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 },
]
const PAGE_NUM_PATTERNS = [
  { k: 'pageOfTotal', label: 'pageNumPatternTotal', pattern: '第 {PAGE} 页 共 {NUMPAGES} 页' },
  { k: 'slash', label: 'pageNumPatternSlash', pattern: '{PAGE} / {NUMPAGES}' },
  { k: 'dash', label: 'pageNumPatternDash', pattern: '- {PAGE} -' },
  { k: 'plain', label: 'pageNumPatternPlain', pattern: '{PAGE}' },
]
const TABLE_BORDER_OPTIONS = [
  { k: 'all', label: 'tableBorderAll' },
  { k: 'threeLine', label: 'tableBorderThreeLine' },
  { k: 'outer', label: 'tableBorderOuter' },
  { k: 'none', label: 'tableBorderNone' },
]
const TABLE_BORDER_PRESETS = {
  all: { outsideBorderWidthPt: 0.75, insideBorderWidthPt: 0.5 },
  threeLine: { outsideBorderWidthPt: 1.5, insideBorderWidthPt: 0.75 },
  outer: { outsideBorderWidthPt: 1, insideBorderWidthPt: 0 },
  none: { borderWidthPt: 0 },
}
const TABLE_FILL_SWATCHES = ['none', '#F1F3F5', '#E3EFEA', '#EBF3FE', '#FDF6EC', '#DEE2E6']
const TABLE_VALIGNS = [
  { k: 'top', label: 'tableVAlignTop' },
  { k: 'center', label: 'tableVAlignCenter' },
  { k: 'bottom', label: 'tableVAlignBottom' },
]
const CALC_NUM_FORMATS = [
  { k: 'general', label: 'calcNumGeneral', code: 'General' },
  { k: 'int', label: 'calcNumInteger', code: '0' },
  { k: 'dec', label: 'calcNumDecimal', code: '0.00' },
  { k: 'thousands', label: 'calcNumThousands', code: '#,##0.00' },
  { k: 'currency', label: 'calcNumCurrency', code: '¥#,##0.00' },
  { k: 'accounting', label: 'calcNumAccounting', code: '_ ¥* #,##0.00_ ' },
  { k: 'percent', label: 'calcNumPercent', code: '0.00%' },
  { k: 'date', label: 'calcNumDate', code: 'YYYY-MM-DD' },
  { k: 'text', label: 'calcNumText', code: '@' },
]
const CALC_CHART_TYPES = [
  { k: 'column', label: 'calcChartCol' },
  { k: 'bar', label: 'calcChartBar' },
  { k: 'line', label: 'calcChartLine' },
  { k: 'pie', label: 'calcChartPie' },
]
const CALC_QUICK_FNS = [
  { fn: 'SUM', label: 'calcFnSum' },
  { fn: 'AVERAGE', label: 'calcFnAvg' },
  { fn: 'COUNT', label: 'calcFnCount' },
  { fn: 'MAX', label: 'calcFnMax' },
  { fn: 'MIN', label: 'calcFnMin' },
]
const IMPRESS_LAYOUTS = [
  { code: 0, label: 'impressLayoutTitleSlide' },
  { code: 1, label: 'impressLayoutTitleContent' },
  { code: 19, label: 'impressLayoutTitleOnly' },
  { code: 20, label: 'impressLayoutBlank' },
]
const SHAPE_SWATCHES = ['#1E293B', '#2563EB', '#2E5A50', '#DC2626', '#D97706', '#7C3AED', '#E2E8F0', '#FFFFFF']

const EMPTY = () => ({ character: {}, paragraph: {}, view: {}, selection: {}, undo: null, calc: null, impress: null })

export default {
  name: 'EditorToolbar',
  components: { ParagraphFormatPanel, SystemFontsPanel },
  emits: ['visual-review', 'toggle-review', 'toggle-semantic-writing', 'toggle-writing-assistance', 'changed', 'ui-state', 'focus-editor', 'ai-format'],
  props: {
    // 文档类型：'writer' | 'calc' | 'impress'（默认 'writer' 保持旧测试兼容）
    docKind: { type: String, default: 'writer' },
    // LibreOffice executor（executeCommand(action, params)）。null 时整条静默。
    executor: { type: Object, default: null },
    // 宿主在「选区/光标动了」「文档改了」时自增，驱动激活态刷新。
    refreshKey: { type: Number, default: 0 },
    reviewOpen: { type: Boolean, default: false },
    // 有据续写面板此刻开着没有 / 这份文档有没有这项能力（两者都由客体页上报）。
    semanticWritingOn: { type: Boolean, default: false },
    semanticWritingAvailable: { type: Boolean, default: false },
    // 自动补全的设置面板同上（dev-board#755）。
    writingAssistanceOn: { type: Boolean, default: false },
    writingAssistanceAvailable: { type: Boolean, default: false },
  },
  data() {
    return {
      state: EMPTY(), styleList: [], fontList: [], menu: '', popPos: null,
      // 视图偏好（格式标记 / 标尺），见 VIEW_PREFS_KEY。按钮高亮以引擎读回为准（get_ui_state
      // 的 view.formattingMarks / view.ruler），这里只是用户想要的目标值。
      viewPrefs: readViewPrefs(), viewPrefsBusy: false, viewPrefsReady: false,
      systemFontsOpen: false,
      // BUG-13：主命令区还能不能往左/右滚，驱动两端渐隐遮罩；由 bindToolbarWheel
      // 里的原生 scroll/resize 监听实时更新，不是一次性算好就不变。
      canScrollLeft: false, canScrollRight: false,
      // 插入菜单：'' | 'table' | 'link' | 'comment' | 'toc' | 'pageNumber'
      insertMode: '', insertErr: '', grid: { r: 0, c: 0 }, linkUrl: '', commentText: '', formText: '', selText: '',
      tocForm: { title: '', levels: 3, position: 'cursor' },
      pageNumForm: { target: 'footer', align: 'center', pattern: PAGE_NUM_PATTERNS[0].pattern },
      // 页面设置与表格属性 PropertyGroup 状态
      pageForm: { orientation: 'portrait', paper: 'A4', widthMm: 210, heightMm: 297, topCm: 2.54, bottomCm: 2.54, leftCm: 3.18, rightCm: 3.18 },
      pageErr: '',
      tableForm: { borderPreset: 'all', headerFill: 'none', cellVerticalAlign: 'center', repeatHeader: false },
      tableErr: '',
      // Excel (calc) 状态与表单
      calcErr: '',
      calcAddressInput: 'A1', calcAddressFocused: false,
      calcFormulaInput: '', calcFormulaFocused: false,
      calcCustomNumFmt: 'General',
      calcSizeForm: { rowHeightPt: 20, colWidthPt: 64 },
      calcValForm: { type: 'list', list: '', min: 0, max: 100 },
      calcCondForm: { operator: '>', value1: '0' },
      calcChartForm: { type: 'column', range: 'A1:B10', title: '' },
      calcCommentText: '',
      calcNameForm: { name: '', range: '' },
      calcPivotForm: { rowField: '', dataField: '' },
      calcRenameText: '',
      // PPT (impress) 状态与表单
      impressErr: '',
      impressNotesInput: '', impressNotesFocused: false,
      impressShapeTextInput: '', impressShapeTextFocused: false,
      impressTableCellForm: { row: 1, col: 1, text: '' },
      selectedShapeIndexOverride: null,
      shapeGeomForm: { left: 50, top: 50, width: 200, height: 100 },
      // 查找替换
      findOpen: false, findText: '', replaceText: '', matchCase: false,
      resolvingRevision: false,
      findTotal: null, findIndex: 0, findErr: '', findTruncated: false,
      // LO 自己的菜单栏/工具栏/状态栏/标尺。默认藏起来——这条工具栏就是它们的
      // 替代品；留一个开关是逃生阀，不是常规路径（开了那个会关文档的 × 也回来）。
      chromeHidden: true,
    }
  },
  computed: {
    ICONS: () => ICONS, ALIGNS: () => ALIGNS,
    TEXT_COLORS: () => TEXT_COLORS, HL_COLORS: () => HL_COLORS, GRID_CELLS: () => GRID_CELLS,
    TEXT_FORMS: () => TEXT_FORMS, MARK_OPTIONS: () => MARK_OPTIONS,
    PAPER_SIZES: () => PAPER_SIZES, MARGIN_PRESETS: () => MARGIN_PRESETS,
    PAGE_NUM_PATTERNS: () => PAGE_NUM_PATTERNS, TABLE_BORDER_OPTIONS: () => TABLE_BORDER_OPTIONS,
    TABLE_FILL_SWATCHES: () => TABLE_FILL_SWATCHES, TABLE_VALIGNS: () => TABLE_VALIGNS,
    CALC_NUM_FORMATS: () => CALC_NUM_FORMATS, CALC_CHART_TYPES: () => CALC_CHART_TYPES,
    CALC_QUICK_FNS: () => CALC_QUICK_FNS,
    IMPRESS_LAYOUTS: () => IMPRESS_LAYOUTS, SHAPE_SWATCHES: () => SHAPE_SWATCHES,
    CN_FONT_SIZES: () => CN_FONT_SIZES, PT_FONT_SIZES: () => PT_FONT_SIZES,
    showCnSizes: () => !isEnglish(),
    systemFontsSupported: () => !!(host.systemFonts && typeof host.systemFonts.list === 'function'),
    isWriter() { return !this.docKind || this.docKind === 'writer' },
    isCalc() { return this.docKind === 'calc' },
    isImpress() { return this.docKind === 'impress' },
    calcState() { return (this.state && this.state.calc) || {} },
    calcSheetsList() {
      const list = (this.calcState && Array.isArray(this.calcState.sheets) && this.calcState.sheets.length)
        ? this.calcState.sheets
        : [(this.calcState && this.calcState.sheet) || 'Sheet1']
      return list
    },
    impressState() { return (this.state && this.state.impress) || {} },
    impressShape() {
      const shapes = (this.impressState && this.impressState.shapes) || []
      if (this.selectedShapeIndexOverride != null) {
        const hit = shapes.find((s) => s.index === this.selectedShapeIndexOverride)
        if (hit) return hit
      }
      return (this.impressState && this.impressState.selectedShape) || shapes[0] || null
    },
    activeShapeIndex() {
      return this.impressShape ? this.impressShape.index : null
    },
    activeShapeName() {
      return (this.impressShape && (this.impressShape.name || this.impressShape.shapeName)) || ''
    },
    impressHasTable() {
      if (this.state && this.state.selection && this.state.selection.inTable) return true
      const shapes = (this.impressState && this.impressState.shapes) || []
      return shapes.some((s) => s && s.isTable)
    },
    formattingMarks() { return this.state.view.formattingMarks != null ? !!this.state.view.formattingMarks : !!this.viewPrefs.formattingMarks },
    rulerOn() { return this.state.view.ruler != null ? !!this.state.view.ruler : !!this.viewPrefs.ruler },
    inTable() { return this.state.selection.inTable === true },
    // 页边显示要引擎支持（LO 7.1+ 且我们的 r3 表格补丁）。worker 读不到那个视图
    // 设置时回 revisionMarginSupported:false，这里把中间项摘掉——不放做不到的选项。
    revisionViewOptions() {
      const balloonsOk = this.state.view.revisionBalloonsSupported !== false
      return REVISION_VIEWS.filter((o) => o.k !== 'balloons' || balloonsOk)
    },
    revisionViewLabel() {
      const cur = this.state.view.revisionView
      const hit = REVISION_VIEWS.find((o) => o.k === cur)
      return hit ? this.$t('editor.toolbar.' + hit.t) : this.$t('editor.toolbar.revisionView')
    },
    // 单元格名如 "B2" → {row:2, col:'B'}。table_* 原语收 1 起的行号与列字母。
    cellPos() {
      const m = /^([A-Z]+)(\d+)$/.exec(String(this.state.selection.cellName || ''))
      return m ? { col: m[1], row: Number(m[2]) } : null
    },
    // 超链接/批注都作用于选区。没有选区就明说「需先选中文字」，不做成点了没反应
    noSelection() { return this.state.selection.collapsed !== false },
    selPreview() {
      const t = this.selText || ''
      return t.length > 12 ? t.slice(0, 12) + '…' : t
    },
    // 取不到被批注文字时不套引号壳——「对「」批注」读起来像出错了（BUG-29）
    commentFormTitle() {
      return this.selPreview
        ? this.$t('editor.toolbar.commentTitle', { sel: this.selPreview })
        : this.$t('editor.toolbar.commentTitleNoSel')
    },
    findStatus() {
      if (!this.findText) return ''
      if (this.findTotal === null) return '…'
      if (this.findTotal === 0) return this.$t('editor.toolbar.noMatch')
      const total = this.findTruncated ? this.findTotal + '+' : this.findTotal
      return this.findIndex
        ? this.$t('editor.toolbar.matchPosition', { index: this.findIndex, total })
        : this.$t('editor.toolbar.matchTotal', { total })
    },
    // 读不到撤销可用性时**不置灰**——宁可多点一下，也不要把能用的功能锁死
    undoDisabled() { return this.state.undo ? this.state.undo.canUndo === false : false },
    redoDisabled() { return this.state.undo ? this.state.undo.canRedo === false : false },
    styleLabel() { return this.localStyleName(this.state.paragraph.styleName || '') || this.$t('editor.toolbar.paraStyle') },
    fontLabel() {
      const f = this.state.character.font || ''
      return f.length > 8 ? f.slice(0, 8) + '…' : (f || this.$t('editor.toolbar.fontFallback'))
    },
    sizeLabel() {
      const s = this.state.character.sizePt
      return s ? (Math.round(s * 10) / 10) : '—'
    },
    styleOptions() {
      const have = {}
      for (const s of this.styleList) have[s.name] = s
      const picks = STYLE_PICKS.filter((n) => have[n])
      const cur = this.state.paragraph.styleName
      if (cur && picks.indexOf(cur) === -1 && have[cur]) picks.unshift(cur)
      return picks.map((n) => ({ name: n, label: this.localStyleName(n, have[n] && have[n].display) }))
    },
    // 中文字体排前面——这是给中国律师用的编辑器，别让他们在 300 个西文字体里翻
    fontOptions() {
      const cjk = [], rest = []
      for (const f of this.fontList) (/[一-龥]/.test(f) ? cjk : rest).push(f)
      return cjk.concat(rest)
    },
  },
  watch: {
    executor: { handler() { this.bootstrap() }, immediate: true },
    refreshKey() { this.refresh() },
    docKind() {
      this.closeMenus()
      this.bootstrap()
    },
  },
  mounted() {
    // 滚轮横滚只能在真实 DOM 上挂（见 methods.bindToolbarWheel）。工具栏自己不会
    // 重建 .etb-scroll，挂一次即可；组件被父级 v-if 掉时走 beforeUnmount 摘掉。
    this.$nextTick(() => this.bindToolbarWheel())
    // BUG-15：手写下拉（menu）原来只靠 .etb 根节点的 @tap 收口，点文档画布
    // （webview，不在这棵 DOM 树里）或右栏 AI 面板都够不到；补一层 document 级
    // 收口——mousedown 走到工具栏外面就关，Esc 也关，画布拿到焦点（webview
    // 抢走 window focus）时同样关，一套处理盖住五个 fixed 弹层（style/font/
    // color/hl/insert/revview 共用同一个 menu 状态）。
    // Esc 只在焦点还在宿主页时由 onDocKeydown 接住；焦点在画布里（webview 客体 /
    // 浏览器态 iframe）时按键进的是客体自己的 document，宿主一个 keydown 都收不到，
    // 客体里的 Esc 另有用途（关引擎原生弹窗，见 doc-editor.md 覆盖层那条），不能去抢。
    // 这个组合靠 blur 那条盖住：焦点要进画布只能先点画布，那一下宿主 window 就 blur，
    // 下拉已经收掉了——「下拉开着、焦点却在画布里」不是一个到得了的状态。
    document.addEventListener('mousedown', this.onDocMouseDown, true)
    document.addEventListener('keydown', this.onDocKeydown, true)
    window.addEventListener('blur', this.closeMenus)
    // v0.49.0 C9-01：popStyle 是打开那一刻的 fixed 快照。分屏开关、标签跨窗格、
    // 左右栏/底栏开合、窗口缩放都会让工具栏换位置，而菜单加速键开分屏、程序化开
    // 右侧文件都不经过上面的 mousedown——弹层悬在另一窗格上，点下去却改的是这份
    // 文档（真机插进了分页符）。工作台里所有布局变化都经 triggerWorkbenchResize
    // 派发 window resize，收口挂在这里。
    window.addEventListener('resize', this.closeMenus)
    VIEW_PREFS_HOSTS.add(this)
  },

  beforeUnmount() {
    if (this._toolbarWheelOff) { this._toolbarWheelOff(); this._toolbarWheelOff = null }
    if (this._toolbarEdgesOff) { this._toolbarEdgesOff(); this._toolbarEdgesOff = null }
    document.removeEventListener('mousedown', this.onDocMouseDown, true)
    document.removeEventListener('keydown', this.onDocKeydown, true)
    window.removeEventListener('blur', this.closeMenus)
    window.removeEventListener('resize', this.closeMenus)
    VIEW_PREFS_HOSTS.delete(this)
  },

  methods: {
    async call(action, params) {
      if (!this.executor) return null
      try { return await this.executor.executeCommand(action, params || {}) }
      catch (e) { return { success: false, message: (e && e.message) || String(e) } }
    },
    async bootstrap() {
      this.viewPrefsReady = false
      this.state = EMPTY()
      if (!this.executor) return
      await this.refresh()
      const [st, fo] = await Promise.all([
        this.isWriter ? this.call('list_styles', {}) : Promise.resolve({ styles: [] }),
        this.call('list_fonts', {}),
      ])
      this.styleList = (st && st.styles) || []
      this.fontList = (fo && fo.families) || []
      // 自建工具栏现已覆盖 Writer / Calc / Impress，LO 原生菜单栏与工具栏统一退场。
      await this.applyChrome(true)
      await this.applyViewPrefs()
      this.viewPrefsReady = true
    },
    async refresh() {
      const r = await this.call('get_ui_state', {})
      if (r && r.success) {
        this.state = r
        if (r.calc) {
          if (!this.calcAddressFocused) this.calcAddressInput = r.calc.address || 'A1'
          if (!this.calcFormulaFocused) this.calcFormulaInput = r.calc.formula != null ? String(r.calc.formula) : ''
          if (r.calc.rowHeightPt > 0) this.calcSizeForm.rowHeightPt = r.calc.rowHeightPt
          if (r.calc.colWidthPt > 0) this.calcSizeForm.colWidthPt = r.calc.colWidthPt
        }
        if (r.impress) {
          if (!this.impressNotesFocused) this.impressNotesInput = r.impress.notesText != null ? String(r.impress.notesText) : ''
          const shapes = Array.isArray(r.impress.shapes) ? r.impress.shapes : []
          const overrideHit = this.selectedShapeIndexOverride != null
            ? shapes.find((s) => s.index === this.selectedShapeIndexOverride)
            : null
          const sh = overrideHit || r.impress.selectedShape || shapes[0]
          if (sh) {
            this.shapeGeomForm = {
              left: sh.left != null ? sh.left : 50,
              top: sh.top != null ? sh.top : 50,
              width: sh.width != null ? sh.width : 200,
              height: sh.height != null ? sh.height : 100,
            }
            if (!this.impressShapeTextFocused) {
              this.impressShapeTextInput = sh.text != null ? String(sh.text) : ''
            }
          }
        }
      }
      // 激活态变了要通知宿主：菜单栏的「修订模式」勾选读的就是这里的
      // state.view.recordChanges，不广播的话菜单会停在上一次的状态。
      this.$emit('ui-state')
    },
    // 命令跑完必须刷新两件事：工具栏自己的激活态，以及宿主的自动保存（改了文档）
    async after(res, changed) {
      if (changed !== false) this.$emit('changed')
      await this.refresh()
      return res
    },
    ui(name) {
      this.closeMenus()
      const payload = { name }
      if (this.isImpress && this.activeShapeName) payload.shapeName = this.activeShapeName
      return this.call('ui_command', payload).then((r) => this.after(r))
    },
    run(action) { this.closeMenus(); return this.call(action, {}).then((r) => this.after(r)) },
    toggleMenu(name) {
      const opening = this.menu !== name
      this.menu = opening ? name : ''
      if (opening) this.capturePopPos(name)
    },
    // 弹层不能留在文档流里定位：工具栏行是横向 scroll-view（overflow 竖向 hidden），
    // 外面还套着 pane/workbench 一串 overflow:hidden，绝对定位的菜单会被裁得只剩
    // 顶边一条、看起来就是「点了打不开」（dev-board#245）。打开瞬间取触发器视口
    // 坐标，用 fixed 逃出所有裁剪上下文；z 序压在弹窗遮罩（1000+）之下、窗格与
    // 编辑器 webview 之上。
    capturePopPos(name) {
      const ref = this.$refs['trig_' + name]
      const el = ref && (ref.$el || ref)
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      this.popPos = rect ? { left: rect.left, top: rect.bottom + 4 } : null
    },
    popStyle(width, tall) {
      if (!this.popPos) return {}
      const vw = (typeof window !== 'undefined' && window.innerWidth) || 0
      const left = vw ? Math.min(this.popPos.left, Math.max(8, vw - width - 8)) : this.popPos.left
      const st = { position: 'fixed', left: left + 'px', top: this.popPos.top + 'px', zIndex: 900 }
      // 段落面板比普通下拉高得多：按视口剩余高度封顶并允许内部滚动，别被窗口底边截断
      if (tall) {
        const vh = (typeof window !== 'undefined' && window.innerHeight) || 0
        if (vh) { st.maxHeight = Math.max(240, vh - this.popPos.top - 12) + 'px'; st.overflowY = 'auto' }
      }
      return st
    },
    closeMenus() { this.menu = ''; this.insertMode = ''; this.insertErr = ''; this.pageErr = ''; this.tableErr = ''; this.calcErr = ''; this.impressErr = '' },
    // BUG-15：点在工具栏 DOM 树之外（文档画布是独立的 webview，够不到；右栏
    // AI 面板是同页面的另一棵子树）都要关掉手写下拉。捕获阶段挂，免得目标元素
    // 自己的 @tap.stop 先把冒泡吃掉。
    onDocMouseDown(e) {
      if (!this.menu) return
      const root = this.$el
      if (root && typeof root.contains === 'function' && root.contains(e.target)) return
      this.closeMenus()
    },
    onDocKeydown(e) {
      if (e.key === 'Escape' && this.menu) this.closeMenus()
    },
    // 纵向滚轮映射成横向滚动，否则窄窗口下右半截命令只能靠拖那条 4px 细滑轨
    // （dev-board#502 / #543，与标签栏 rebindTabsWheel 同一实现）。必须用原生
    // addEventListener 挂在 uni 渲染出的真实元素上——模板上的 @wheel 收到的是
    // uni 重建过的普通对象，第一道守卫就 return（理由写在 horizontalWheel.js）。
    bindToolbarWheel() {
      const root = this.$el
      const el = root && typeof root.querySelector === 'function' ? root.querySelector('.etb-scroll') : null
      if (!el) return
      this._toolbarWheelOff = bindHorizontalWheel(el)
      // BUG-13：两端渐隐遮罩跟着**真正滚动的内层 div** 量（uni-h5 的 scroll-view 是
      // uni-scroll-view > div > div(overflow-x:auto) > .uni-scroll-view-content，scroll
      // 事件只在倒数第二层派发、也不冒泡——挂在 el 上是死代码，见 utils/scrollEdges.js）。
      // 横滚、窗口尺寸变化、按钮组进出（表格组随光标出现）都会重新量。
      // BUG-15：popStyle 是打开那一刻的 getBoundingClientRect 快照，工具栏一滚触发器就
      // 跟弹层脱开——只在 scrollLeft 真变了时收掉下拉（内容宽度变化不算，否则「插入」
      // 下拉打开时顺手刷新状态、表格组一进出，下拉就被自己关掉）。
      this._toolbarEdgesOff = watchScrollEdges(el, {
        onEdges: ({ left, right }) => { this.canScrollLeft = left; this.canScrollRight = right },
        onScrolled: () => { if (this.menu) this.closeMenus() },
      })
    },

    // ---- 插入菜单 ----
    openInsert() {
      const opening = this.menu !== 'insert'
      this.insertMode = ''; this.insertErr = ''; this.grid = { r: 0, c: 0 }
      this.menu = opening ? 'insert' : ''
      if (opening) this.capturePopPos('insert')
      // 选区文字要现读：菜单里要显示「给『xxx』加链接」，而 get_ui_state 只回
      // collapsed 布尔值。顺带刷新一次状态，免得按上一次的选区判空。
      if (opening) {
        this.refresh()
        this.call('get_selection', {}).then((r) => { this.selText = (r && r.text) || '' })
      }
    },
    startText(kind) { this.formText = ''; this.insertErr = ''; this.insertMode = kind },
    doTextForm() {
      const form = TEXT_FORMS[this.insertMode]
      if (!form) return null
      const text = String(this.formText || '').trim()
      if (!text) { this.insertErr = this.$t('editor.toolbar.textRequired'); return null }
      const params = Object.assign({ [form.arg]: text }, form.extra || {})
      return this.call(form.action, params).then((res) => this.finishInsert(res))
    },
    startToc() {
      this.insertErr = ''
      this.tocForm = { title: this.$t('editor.toolbar.tocDefaultTitle'), levels: 3, position: 'cursor' }
      this.insertMode = 'toc'
    },
    doInsertToc() {
      const title = String(this.tocForm.title || '').trim() || this.$t('editor.toolbar.tocDefaultTitle')
      return this.call('insert_toc', {
        title,
        levels: Number(this.tocForm.levels) || 3,
        position: this.tocForm.position || 'cursor',
      }).then((res) => this.finishInsert(res))
    },
    startPageNumber() {
      this.insertErr = ''
      this.pageNumForm = { target: 'footer', align: 'center', pattern: PAGE_NUM_PATTERNS[0].pattern }
      this.insertMode = 'pageNumber'
    },
    doInsertPageNumber() {
      return this.call('edit_header_footer', {
        target: this.pageNumForm.target || 'footer',
        align: this.pageNumForm.align || 'center',
        pageNumberPattern: this.pageNumForm.pattern || PAGE_NUM_PATTERNS[0].pattern,
      }).then((res) => this.finishInsert(res))
    },
    // ---- 页面设置（ElyOffice PropertyGroup 检查器卡片） ----
    openPageMenu() {
      const opening = this.menu !== 'page'
      this.pageErr = ''
      this.menu = opening ? 'page' : ''
      if (opening) {
        this.capturePopPos('page')
        this.call('get_formatting', {}).then((r) => {
          if (r && r.page) this.syncPageForm(r.page)
        })
      }
    },
    syncPageForm(pg) {
      if (!pg) return
      const land = !!pg.landscape || pg.orientation === 'landscape'
      this.pageForm.orientation = land ? 'landscape' : 'portrait'
      if (pg.width > 0 && pg.height > 0) {
        this.pageForm.widthMm = pg.width
        this.pageForm.heightMm = pg.height
        const shortSide = Math.min(pg.width, pg.height)
        const longSide = Math.max(pg.width, pg.height)
        const hit = PAPER_SIZES.find((p) => Math.abs(p.width - shortSide) < 2 && Math.abs(p.height - longSide) < 2)
        if (hit) this.pageForm.paper = hit.k
      }
      if (pg.margins) {
        const toCm = (mm) => Math.round((Number(mm) / 10) * 100) / 100
        if (pg.margins.top != null) this.pageForm.topCm = toCm(pg.margins.top)
        if (pg.margins.bottom != null) this.pageForm.bottomCm = toCm(pg.margins.bottom)
        if (pg.margins.left != null) this.pageForm.leftCm = toCm(pg.margins.left)
        if (pg.margins.right != null) this.pageForm.rightCm = toCm(pg.margins.right)
      }
    },
    async applyPageOrientation(orientation) {
      this.pageErr = ''
      this.pageForm.orientation = orientation
      const res = await this.call('set_page_setup', { orientation })
      if (!res || res.success !== true) {
        this.pageErr = (res && res.message) || this.$t('editor.toolbar.opFailed')
        return null
      }
      if (res.page) this.syncPageForm(res.page)
      return this.after(res)
    },
    async applyPaperSize(p) {
      this.pageErr = ''
      this.pageForm.paper = p.k
      const isLand = this.pageForm.orientation === 'landscape'
      const width = isLand ? p.height : p.width
      const height = isLand ? p.width : p.height
      this.pageForm.widthMm = width
      this.pageForm.heightMm = height
      const res = await this.call('set_page_setup', { width, height, orientation: this.pageForm.orientation })
      if (!res || res.success !== true) {
        this.pageErr = (res && res.message) || this.$t('editor.toolbar.opFailed')
        return null
      }
      if (res.page) this.syncPageForm(res.page)
      return this.after(res)
    },
    useMarginPreset(m) {
      this.pageForm.topCm = m.top
      this.pageForm.bottomCm = m.bottom
      this.pageForm.leftCm = m.left
      this.pageForm.rightCm = m.right
      return this.applyPageMargins()
    },
    async applyPageMargins() {
      this.pageErr = ''
      const mm = (cm) => Math.round(Number(cm) * 10 * 10) / 10
      const margins = {
        top: mm(this.pageForm.topCm),
        bottom: mm(this.pageForm.bottomCm),
        left: mm(this.pageForm.leftCm),
        right: mm(this.pageForm.rightCm),
      }
      if (Object.values(margins).some((v) => !Number.isFinite(v) || v < 0)) {
        this.pageErr = this.$t('editor.toolbar.opFailed')
        return null
      }
      const res = await this.call('set_page_setup', { margins })
      if (!res || res.success !== true) {
        this.pageErr = (res && res.message) || this.$t('editor.toolbar.opFailed')
        return null
      }
      if (res.page) this.syncPageForm(res.page)
      return this.after(res)
    },
    // ---- 表格属性（ElyOffice PropertyGroup 检查器卡片） ----
    openTableMenu() {
      const opening = this.menu !== 'table'
      this.tableErr = ''
      this.menu = opening ? 'table' : ''
      if (opening) {
        this.capturePopPos('table')
        this.call('get_formatting', {}).then((r) => {
          if (r && r.table) {
            if (r.table.repeatHeader != null) this.tableForm.repeatHeader = !!r.table.repeatHeader
            if (r.table.headerFill != null) this.tableForm.headerFill = r.table.headerFill
          }
        })
      }
    },
    async applyTableFormat(patch) {
      if (!patch) return null
      this.tableErr = ''
      const params = Object.assign({}, patch)
      if (patch.borderPreset) {
        this.tableForm.borderPreset = patch.borderPreset
        Object.assign(params, TABLE_BORDER_PRESETS[patch.borderPreset] || {})
      }
      if (patch.headerFill != null) this.tableForm.headerFill = patch.headerFill
      if (patch.cellVerticalAlign != null) this.tableForm.cellVerticalAlign = patch.cellVerticalAlign
      if (patch.repeatHeader != null) this.tableForm.repeatHeader = !!patch.repeatHeader
      const res = await this.call('format_table', params)
      if (!res || res.success !== true) {
        this.tableErr = (res && res.message) || this.$t('editor.toolbar.opFailed')
        return null
      }
      return this.after(res)
    },
    // 表格相对操作。position 的语义是「插在该行/列之前」，缺省追加到末尾——
    // 所以「下方插入」= position+1，「右侧插入」= 列号+1。删除直接给当前行/列。
    async tableOp(op) {
      const pos = this.cellPos
      if (!pos) return null
      const colNum = pos.col.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
      const map = {
        rowAbove: ['table_add_row', { position: pos.row }],
        rowBelow: ['table_add_row', { position: pos.row + 1 }],
        colLeft: ['table_add_col', { position: colNum }],
        colRight: ['table_add_col', { position: colNum + 1 }],
        delRow: ['table_delete_row', { position: pos.row }],
        delCol: ['table_delete_col', { position: colNum }],
      }
      const spec = map[op]
      if (!spec) return null
      const res = await this.call(spec[0], spec[1])
      // 引擎拒绝（如合并过单元格的表按列插入）要如实说，不能默默什么都没发生
      if (!res || res.success !== true) { this.insertErr = (res && res.message) || this.$t('editor.toolbar.opFailed'); return null }
      this.insertErr = ''
      return this.after(res)
    },
    startLink() {
      if (this.noSelection) return
      this.linkUrl = ''; this.insertErr = ''; this.insertMode = 'link'
    },
    startComment() {
      if (this.noSelection) return
      this.commentText = ''; this.insertErr = ''; this.insertMode = 'comment'; this.selText = ''
      // 选区文字进表单时现读（BUG-29）：文档菜单「插入批注」不经 openInsert，
      // 只靠下拉打开时那一次读数，标题要么是空串、要么是上一次的旧选区。
      this.call('get_selection', {}).then((r) => { this.selText = (r && r.text) || '' })
    },
    // 失败必须说出来。工具栏上「点了没反应」和「点了偷偷失败」一样糟。
    async finishInsert(res, okMsg) {
      if (!res || res.success !== true) {
        this.insertErr = (res && res.message) || this.$t('editor.toolbar.opFailed')
        return false
      }
      this.closeMenus()
      await this.after(res)
      return true
    },
    doInsertTable(r, c) {
      // insert_table 收的是内容矩阵（string[][]），空表就是全空串；headerRow
      // 关掉——用户手工插的表还没内容，先加粗首行没有意义。
      const rows = []
      for (let i = 0; i < r; i++) rows.push(new Array(c).fill(''))
      return this.call('insert_table', { rows, headerRow: false }).then((res) => this.finishInsert(res))
    },
    doLink() {
      const url = String(this.linkUrl || '').trim()
      if (!url) { this.insertErr = this.$t('editor.toolbar.linkRequired'); return null }
      return this.call('set_selection_hyperlink', { url }).then((res) => this.finishInsert(res))
    },
    doComment() {
      const comment = String(this.commentText || '').trim()
      if (!comment) { this.insertErr = this.$t('editor.toolbar.commentRequired'); return null }
      return this.call('add_comment_at_selection', { comment }).then((res) => this.finishInsert(res))
    },
    // 图片走浏览器原生文件选择：引擎的 .uno:InsertGraphic 会开 LO 自己的文件
    // 对话框，在 WASM 里够不到本机文件系统。读成 dataURL 交给 insert_image。
    pickImage() {
      const el = document.createElement('input')
      el.type = 'file'
      el.accept = 'image/*'
      el.onchange = () => {
        const f = el.files && el.files[0]
        if (!f) return
        const fr = new FileReader()
        fr.onload = () => this.call('insert_image', { dataUrl: String(fr.result) }).then((res) => this.finishInsert(res))
        fr.onerror = () => { this.insertErr = this.$t('editor.toolbar.imageReadFailed') }
        fr.readAsDataURL(f)
      }
      el.click()
    },
    // 样式名显示：本地化表优先（引擎的 DisplayName 在部分构建上回英文），
    // 表里没有就用引擎给的，再没有才退回程序名。
    localStyleName(name, display) {
      if (!name) return ''
      const key = 'editor.toolbar.styleNames.' + name
      const hit = this.$t(key)
      if (hit && hit !== key) return hit
      return display || name
    },
    applyStyle(name) {
      this.closeMenus()
      return this.call('set_style', { kind: 'paragraph', styleName: name }).then((r) => this.after(r))
    },
    // 字符格式一律带 atCursor：没有选区时设在光标处、之后敲的字沿用（Word 语义，
    // 用户实测反馈「没选中内容字号栏就不能操作」）。设完把键盘焦点还给画布，
    // 用户点完字号直接接着打字，不用再点一下文档。
    charFormat(params) {
      const payload = Object.assign({ atCursor: true }, params)
      if (this.isImpress && this.activeShapeName && !payload.shapeName) {
        payload.shapeName = this.activeShapeName
      }
      return this.call('format_selection', payload).then(async (r) => {
        await this.after(r, !(r && r.atCursor))
        this.$emit('focus-editor')
        return r
      })
    },
    applyFont(family) {
      this.closeMenus()
      return this.charFormat({ fontName: family })
    },
    applyColor(kind, value) {
      this.closeMenus()
      return this.charFormat({ [kind]: value })
    },
    sizeMatches(pt) { return Math.abs((Number(this.state.character.sizePt) || 0) - pt) < 0.05 },
    setSize(pt) {
      this.closeMenus()
      if (!(pt > 0)) return null
      return this.charFormat({ fontSize: pt })
    },
    // 字号步进：本引擎的 .uno:Grow/.uno:Shrink 是哑弹，只能读回当前值再写。
    // 按常用字号表跳档，而不是 ±1——12→14→16 才是人的用法。
    stepSize(dir) {
      const cur = Number(this.state.character.sizePt) || 12
      let idx = SIZES.findIndex((s) => s >= cur - 0.01)
      if (idx < 0) idx = SIZES.length - 1
      if (dir > 0 && SIZES[idx] <= cur + 0.01) idx++
      else if (dir < 0) idx--
      const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, idx))]
      if (!next || Math.abs(next - cur) < 0.01) return null
      return this.charFormat({ fontSize: next })
    },
    stepZoom(delta) {
      return this.call('set_zoom', { delta }).then((r) => this.after(r, false))
    },
    resetZoom() { return this.call('set_zoom', { value: 100 }).then((r) => this.after(r, false)) },
    toggleTrack() {
      const next = !this.state.view.recordChanges
      return this.call('set_track_changes', { on: next }).then((r) => this.after(r, false))
    },
    // #66 PR-B：接受/拒绝光标处那一条。失败（光标不在修订上）用 toast，不标脏。
    async resolveAtCursor(action) {
      if (this.resolvingRevision) return null
      this.closeMenus()
      this.resolvingRevision = true
      try {
        const r = await this.call('resolve_revision_at_cursor', { action })
        if (!r || r.success !== true) {
          const msg = (r && r.message) || this.$t('editor.toolbar.resolveCurrentFailed')
          try { uni.showToast({ title: msg, icon: 'none' }) } catch (e) {}
          return r
        }
        return await this.after(r)
      } finally {
        this.resolvingRevision = false
      }
    },
    async resolveAllRevisions(action) {
      if (this.resolvingRevision) return null
      this.closeMenus()
      this.resolvingRevision = true
      try {
        const r = await this.call('resolve_all_revisions', { action })
        if (!r || r.success !== true) {
          const msg = (r && r.message) || this.$t('editor.toolbar.resolveAllFailed')
          try { uni.showToast({ title: msg, icon: 'none' }) } catch (e) {}
          return r
        }
        return await this.after(r)
      } finally {
        this.resolvingRevision = false
      }
    },

    // 修订显示方式。changed=false：一个字节都没改，别把文档标脏触发自动保存。
    // 高亮不在这里本地置位——after() 会重跑 get_ui_state，按引擎读回的真实态刷新。
    pickRevisionView(mode) {
      this.closeMenus()
      return this.call('set_revision_view', { mode }).then((r) => this.after(r, false))
    },
    // LO chrome 开关。hideElement 的返回值不可信，原语内部用 isElementVisible
    // 复核后回报，这里只按结果记状态。
    // 标尺不再跟着 LO chrome 一起藏：它归视图偏好管（默认显示，见 VIEW_PREFS_KEY）。
    async applyChrome(hide) {
      const res = await this.call('set_chrome', {
        menubar: !hide, statusbar: !hide, toolbars: !hide,
      })
      if (res && res.success) this.chromeHidden = hide
      return res
    },
    toggleChrome() { this.closeMenus(); return this.applyChrome(!this.chromeHidden) },
    // load_document 会把 LO 自己那套 chrome（菜单栏 / 两排工具栏 / 状态栏 / 标尺）重新
    // 拉出来（真机实证，见 office_thread.js 的 hideNativeChrome 注释 ②），而 bootstrap
    // 只在 executor 变化时跑一次——「就地重载」（版本退回 / 回到主线工作 / 采纳一稿）换的
    // 是同一个 executor 手里的文档，没人再去藏一次，编辑区顶上就冒出整条原生菜单栏和
    // 标尺（真机反馈 B5）。宿主换完文档后调这一条。
    // 落的是**当前**开关状态而不是一律藏起来：设置里留了把 LO chrome 放出来的逃生开关，
    // 律师自己打开的那一套不该被一次重载又摁回去。
    async reapplyChrome() {
      const res = await this.applyChrome(this.chromeHidden)
      await this.applyViewPrefs()
      return res
    },
    // 按用户偏好把格式标记 / 标尺设成确定态（set_view_options 直写 ViewSettings）。
    // changed=false：纯视图，不能标脏触发自动保存。
    async applyViewPrefs(prefs = this.viewPrefs) {
      if (this.docKind === 'calc' || this.docKind === 'impress') {
        await this.refresh()
        return { success: true }
      }
      const r = await this.call('set_view_options', {
        ...prefs, formattingMarks: !!prefs.formattingMarks, ruler: !!prefs.ruler,
        // Writer 开格式标记时会把文本边界画成整页矩形；只隐藏辅助线，保留 ¶ 和标尺偏好。
        textBoundaries: false,
      })
      if (r && r.success) await this.refresh()
      return r
    },
    async updateViewPrefs(patch) {
      if (this.viewPrefsBusy) return
      this.viewPrefsBusy = true
      // 所有文档共享一个偏好：串行完成写入和广播，排队后再读取最新值。
      const update = viewPrefsUpdate.then(async () => {
        const previous = readViewPrefs()
        const next = { ...previous, ...(typeof patch === 'function' ? patch(previous) : patch) }
        try {
          const r = await this.applyViewPrefs(next)
          if (!r || !r.success) throw new Error(this.$t('editor.toolbar.viewPrefsFailed'))
          writeViewPrefs(next)
          this.viewPrefs = next
        } catch (e) {
          this.viewPrefs = previous
          await this.applyViewPrefs(previous)
          uni.showToast({ title: this.$t('editor.toolbar.viewPrefsFailed'), icon: 'none' })
          return
        }
        await Promise.all([...VIEW_PREFS_HOSTS].filter(host => host !== this).map(async host => {
          host.viewPrefs = { ...next }
          await host.applyViewPrefs()
        }))
      })
      viewPrefsUpdate = update.catch(() => {})
      try { await update } finally { this.viewPrefsBusy = false }
    },
    setViewPref(key, value) { return this.updateViewPrefs({ [key]: !!value }) },
    markVisible(key) {
      if (!this.formattingMarks) return false
      return this.state.view[key] != null ? !!this.state.view[key] : this.viewPrefs[key] !== false
    },
    setMark(key, value) {
      return this.updateViewPrefs(prefs => {
        // 总闸关闭时单独勾选一类，只打开这一类。
        const marks = Object.fromEntries(MARK_OPTIONS.map(o => [o.key, prefs.formattingMarks && prefs[o.key] !== false]))
        marks[key] = !!value
        return { ...marks, formattingMarks: Object.values(marks).some(Boolean) }
      })
    },
    setAllMarks(value) {
      return this.updateViewPrefs({ ...Object.fromEntries(MARK_OPTIONS.map(o => [o.key, !!value])), formattingMarks: !!value })
    },

    // ---- 查找替换 ----
    toggleFind() {
      this.findOpen = !this.findOpen
      this.closeMenus()
      if (!this.findOpen) { this.findErr = ''; return }
      this.findTotal = null; this.findIndex = 0; this.findErr = ''
    },
    toggleCase() { this.matchCase = !this.matchCase; this.findIndex = 0; this.onFindInput() },
    // 打字时不要每个字符都去搜一遍整篇文档——搜索跑在 office 线程上，连打会卡。
    onFindInput() {
      clearTimeout(this._findTimer)
      this.findTotal = null; this.findIndex = 0
      if (!this.findText) return
      this._findTimer = setTimeout(() => this.findNext(), 350)
    },
    async findGo(direction) {
      const keyword = String(this.findText || '')
      if (!keyword) return null
      this.findErr = ''
      const r = await this.call('find_navigate', { keyword, direction, matchCase: this.matchCase })
      if (!r || r.success !== true) { this.findErr = (r && r.message) || this.$t('editor.toolbar.findFailed'); return null }
      this.findTotal = r.total || 0
      this.findTruncated = !!r.truncated
      this.findIndex = r.found ? r.index : 0
      // 选区变了，工具栏激活态跟着刷新（但没改文档，别标脏）
      await this.refresh()
      return r
    },
    findNext() { return this.findGo('next') },
    findPrev() { return this.findGo('prev') },
    // 替换当前这一处：查找栏已经把它选中了，直接替换选区。RecordChanges 开着时
    // replace_selection 走最小修订路径，跟 AI 改文档同一条路。
    async replaceCurrent() {
      if (!this.findText) return
      if (!this.findIndex) { const r = await this.findNext(); if (!r || !r.found) return }
      const res = (this.isCalc || this.isImpress)
        ? await this.call('find_replace', {
          findText: String(this.findText || ''),
          replaceText: String(this.replaceText || ''),
          replaceAll: false,
          matchCase: this.matchCase,
        })
        : await this.call('replace_selection', { text: String(this.replaceText || '') })
      if (!res || res.success === false) { this.findErr = (res && res.message) || this.$t('editor.toolbar.replaceFailed'); return }
      this.$emit('changed')
      this.findIndex = 0
      await this.findNext()
    },
    async replaceAll() {
      const findText = String(this.findText || '')
      if (!findText) return
      const res = await this.call('find_replace', {
        findText, replaceText: String(this.replaceText || ''), replaceAll: true, matchCase: this.matchCase,
      })
      if (!res || res.success !== true) { this.findErr = (res && res.message) || this.$t('editor.toolbar.replaceFailed'); return }
      this.findErr = res.replaced ? '' : this.$t('editor.toolbar.nothingReplaced')
      this.findTotal = 0; this.findIndex = 0
      await this.after(res)
    },
    // 格式标记 / 标尺：纯视图开关，按引擎读回的当前态取反，写进用户偏好。
    toggleRuler() { return this.setViewPref('ruler', !this.rulerOn) },

    // ---- 段落格式面板 ----
    openParagraphPanel() {
      const opening = this.menu !== 'para'
      this.menu = opening ? 'para' : ''
      if (opening) { this.capturePopPos('para'); this.refresh() }
    },
    onParagraphApplied(r) { this.$emit('changed'); this.refresh(); return r },
    // 交给 AI：工具栏不知道文件名，交给 LibreOfficeEditor 拼好 prompt 再发进对话
    onAiFormat(payload) {
      this.closeMenus()
      this.$emit('ai-format', payload || {})
    },
    // 所内标准格式（全文）：确定性原语 apply_house_style，整篇改动先确认。
    runHouseStyle() {
      this.closeMenus()
      uni.showModal({
        title: this.$t('editor.format.houseStyleConfirmTitle'),
        content: this.$t('editor.format.houseStyleConfirm'),
        success: async (m) => {
          if (!m || !m.confirm) return
          const r = await this.call('apply_house_style', {})
          if (!r || r.success !== true) {
            uni.showToast({ title: (r && r.message) || this.$t('editor.toolbar.opFailed'), icon: 'none' })
            return
          }
          await this.after(r)
        },
      })
    },
    // ---- 本机字体 ----
    openSystemFonts() { this.closeMenus(); this.systemFontsOpen = true },
    onSystemFontsSaved() {
      uni.showToast({ title: this.$t('editor.systemFonts.savedToast'), icon: 'none' })
    },

    // ---- Excel (calc) 顶栏、公式栏与 ElyOffice PropertyGroup 卡片方法 ----
    openCalcMenu(name) {
      const opening = this.menu !== name
      this.calcErr = ''
      this.menu = opening ? name : ''
      if (opening) {
        this.capturePopPos(name)
        this.refresh()
        if (name === 'calcInsert') {
          this.calcChartForm.range = (this.calcState && this.calcState.range) || 'A1:B10'
          this.calcNameForm.range = (this.calcState && this.calcState.range) || (this.calcState && this.calcState.address) || 'A1'
        } else if (name === 'calcSheet') {
          this.calcRenameText = (this.calcState && this.calcState.sheet) || ''
        }
      }
    },
    async runCalcOp(action, params, closeOnOk = false) {
      this.calcErr = ''
      const res = await this.call(action, params || {})
      if (!res || res.success !== true) {
        const msg = (res && (res.message || res.error)) || this.$t('editor.toolbar.opFailed')
        this.calcErr = msg
        if (!this.menu) {
          try { uni.showToast({ title: msg, icon: 'none' }) } catch (e) {}
        }
        return null
      }
      if (closeOnOk) this.closeMenus()
      return this.after(res)
    },
    toggleCalcWrap() {
      const next = !(this.calcState && this.calcState.wrap)
      return this.runCalcOp('sheet_format_cells', { wrap: next })
    },
    toggleCalcMerge() {
      const merged = !!(this.calcState && this.calcState.merged)
      const range = (this.calcState && this.calcState.range) || (this.calcState && this.calcState.address) || 'A1'
      return this.runCalcOp('sheet_merge_cells', { range, action: merged ? 'unmerge' : 'merge' })
    },
    applyCalcVAlign(vAlign) {
      return this.runCalcOp('sheet_format_cells', { vAlign })
    },
    applyCalcNumberFormat(code) {
      const fmt = String(code || '').trim()
      if (!fmt) return null
      this.calcCustomNumFmt = fmt
      return this.runCalcOp('sheet_format_cells', { numberFormat: fmt }, true)
    },
    applyCalcBorder(preset, widthPt) {
      return this.runCalcOp('sheet_set_borders', { preset, widthPt: widthPt != null ? widthPt : 0.75 })
    },
    editCalcRowsCols(action, position) {
      return this.runCalcOp('sheet_edit_rows_cols', { action, position: position || 'before', count: 1 })
    },
    applyCalcRowColSize() {
      const rowHeightPt = Number(this.calcSizeForm.rowHeightPt)
      const colWidthPt = Number(this.calcSizeForm.colWidthPt)
      const params = {}
      if (rowHeightPt > 0) params.rowHeightPt = rowHeightPt
      if (colWidthPt > 0) params.colWidthPt = colWidthPt
      return this.runCalcOp('sheet_set_row_col', params)
    },
    autoFitCalc(kind) {
      return this.runCalcOp('sheet_set_row_col', kind === 'rows' ? { autoFitRows: true } : { autoFitCols: true })
    },
    sortCalcRange(ascending) {
      return this.runCalcOp('sheet_sort_range', { ascending: !!ascending, hasHeader: true })
    },
    toggleCalcAutoFilter() {
      const next = !(this.calcState && this.calcState.autoFilter)
      return this.runCalcOp('sheet_set_autofilter', { enabled: next })
    },
    applyCalcValidation() {
      const t = this.calcValForm.type || 'list'
      if (t === 'list') {
        const list = String(this.calcValForm.list || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        return this.runCalcOp('sheet_set_data_validation', { type: 'list', list }, true)
      }
      return this.runCalcOp('sheet_set_data_validation', {
        type: t,
        operator: 'between',
        value1: String(this.calcValForm.min != null ? this.calcValForm.min : 0),
        value2: String(this.calcValForm.max != null ? this.calcValForm.max : 100),
      }, true)
    },
    clearCalcValidation() {
      return this.runCalcOp('sheet_set_data_validation', { type: 'any' }, true)
    },
    applyCalcCondFormat(bgColor, fontColor) {
      return this.runCalcOp('sheet_conditional_format', {
        operator: this.calcCondForm.operator || '>',
        value1: String(this.calcCondForm.value1 != null ? this.calcCondForm.value1 : '0'),
        bgColor,
        fontColor,
      })
    },
    clearCalcCondFormat() {
      return this.runCalcOp('sheet_conditional_format', { clear: true })
    },
    groupCalcRowsCols(action, orientation) {
      return this.runCalcOp('sheet_group_rows_cols', { action, orientation })
    },
    insertCalcChart() {
      const range = String(this.calcChartForm.range || '').trim() || (this.calcState && this.calcState.range) || 'A1:B10'
      return this.runCalcOp('sheet_add_chart', {
        type: this.calcChartForm.type || 'column',
        range,
        title: String(this.calcChartForm.title || '').trim(),
      }, true)
    },
    saveCalcComment() {
      const text = String(this.calcCommentText || '').trim()
      if (!text) { this.calcErr = this.$t('editor.toolbar.commentRequired'); return null }
      const cell = (this.calcState && this.calcState.address) || 'A1'
      return this.runCalcOp('sheet_add_comment', { cell, text }, true)
    },
    deleteCalcComment() {
      const cell = (this.calcState && this.calcState.address) || 'A1'
      return this.runCalcOp('sheet_delete_comment', { cell }, true)
    },
    defineCalcName() {
      const name = String(this.calcNameForm.name || '').trim()
      const range = String(this.calcNameForm.range || '').trim() || (this.calcState && this.calcState.range) || 'A1'
      if (!name) { this.calcErr = this.$t('editor.toolbar.textRequired'); return null }
      return this.runCalcOp('sheet_define_name', { action: 'add', name, range }, true)
    },
    insertCalcPivot() {
      const rowField = String(this.calcPivotForm.rowField || '').trim()
      const dataField = String(this.calcPivotForm.dataField || '').trim()
      const sourceRange = (this.calcState && this.calcState.range) || 'A1:D20'
      return this.runCalcOp('sheet_add_pivot_table', {
        sourceRange,
        rowFields: rowField ? [rowField] : [],
        dataFields: dataField ? [dataField] : [],
      }, true)
    },
    freezeCalcPanes(cols, rows) {
      return this.runCalcOp('sheet_freeze_panes', { cols, rows }, true)
    },
    freezeCalcAtCurrent() {
      const c = Number((this.calcState && this.calcState.col) || 0)
      const r = Number((this.calcState && this.calcState.row) || 0)
      const cols = (c === 0 && r === 0) ? 1 : c
      const rows = (c === 0 && r === 0) ? 1 : r
      return this.runCalcOp('sheet_freeze_panes', { cols, rows }, true)
    },
    switchCalcSheet(name) {
      if (!name) return null
      return this.runCalcOp('sheet_manage_sheets', { action: 'activate', name })
    },
    addCalcSheet() {
      const sheets = (this.calcState && Array.isArray(this.calcState.sheets)) ? this.calcState.sheets : []
      const existing = new Set(sheets)
      let idx = sheets.length + 1
      while (existing.has('Sheet' + idx)) idx++
      return this.runCalcOp('sheet_manage_sheets', { action: 'add', name: 'Sheet' + idx })
    },
    renameCalcSheet() {
      const newName = String(this.calcRenameText || '').trim()
      if (!newName) { this.calcErr = this.$t('editor.toolbar.textRequired'); return null }
      return this.runCalcOp('sheet_manage_sheets', {
        action: 'rename',
        name: (this.calcState && this.calcState.sheet) || '',
        newName,
      }, true)
    },
    deleteCalcSheet() {
      return this.runCalcOp('sheet_manage_sheets', {
        action: 'delete',
        name: (this.calcState && this.calcState.sheet) || '',
      }, true)
    },
    toggleCalcProtect() {
      const isProt = !!(this.calcState && this.calcState.protected)
      return this.runCalcOp('sheet_protect_sheet', { action: isProt ? 'unprotect' : 'protect' })
    },
    async toggleCalcGridlines() {
      const cur = !(this.state && this.state.view && this.state.view.showGrid === false)
      const r = await this.call('set_view_options', { showGrid: !cur })
      if (r && r.success) await this.refresh()
      return r
    },
    async submitCalcAddress() {
      const range = String(this.calcAddressInput || '').trim()
      if (!range) return null
      this.calcAddressFocused = false
      const res = await this.call('sheet_select_range', { range })
      await this.refresh()
      this.$emit('focus-editor')
      return res
    },
    async submitCalcFormula() {
      const cell = (this.calcState && this.calcState.address) || 'A1'
      this.calcFormulaFocused = false
      const res = await this.runCalcOp('sheet_write_cells', {
        startCell: cell,
        rows: [[this.calcFormulaInput != null ? String(this.calcFormulaInput) : '']],
      })
      this.$emit('focus-editor')
      return res
    },
    cancelCalcFormula() {
      this.calcFormulaFocused = false
      this.calcFormulaInput = (this.calcState && this.calcState.formula != null) ? String(this.calcState.formula) : ''
      this.$emit('focus-editor')
    },
    insertCalcQuickFormula(fnName) {
      const fn = String(fnName || 'SUM').toUpperCase()
      const addr = String((this.calcState && this.calcState.address) || 'A1')
      const selRange = String((this.calcState && this.calcState.range) || '')
      let refRange = 'A1:A10'
      if (selRange && selRange.indexOf(':') !== -1) {
        refRange = selRange
      } else {
        const m = /^([A-Z]+)(\d+)$/i.exec(addr)
        if (m) {
          const colLet = m[1].toUpperCase()
          const rowNum = Number(m[2]) || 1
          if (rowNum > 1) refRange = colLet + '1:' + colLet + (rowNum - 1)
          else refRange = colLet + '2:' + colLet + '10'
        }
      }
      this.calcFormulaInput = '=' + fn + '(' + refRange + ')'
      return this.submitCalcFormula()
    },

    // ---- PPT (impress) 顶栏与 ElyOffice PropertyGroup 卡片方法 ----
    openImpressSlideMenu() {
      return this.openImpressMenu('impressSlide')
    },
    openImpressMenu(name) {
      const opening = this.menu !== name
      this.impressErr = ''
      this.grid = { r: 0, c: 0 }
      this.menu = opening ? name : ''
      if (opening) {
        this.capturePopPos(name)
        this.refresh()
      }
    },
    async runImpressOp(action, params, closeOnOk = false) {
      this.impressErr = ''
      const res = await this.call(action, params || {})
      if (!res || res.success !== true) {
        const msg = (res && (res.message || res.error)) || this.$t('editor.toolbar.opFailed')
        this.impressErr = msg
        if (!this.menu) {
          try { uni.showToast({ title: msg, icon: 'none' }) } catch (e) {}
        }
        return null
      }
      if (closeOnOk) this.closeMenus()
      return this.after(res)
    },
    async gotoSlide(slideNumber) {
      const total = (this.impressState && this.impressState.slideCount) || 1
      const target = Math.max(1, Math.min(total, Number(slideNumber) || 1))
      const res = await this.call('slide_goto', { slideNumber: target })
      if (res && res.success) {
        this.selectedShapeIndexOverride = null
        await this.refresh()
      }
      return res
    },
    prevSlide() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      if (cur <= 1) return null
      return this.gotoSlide(cur - 1)
    },
    nextSlide() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const total = (this.impressState && this.impressState.slideCount) || 1
      if (cur >= total) return null
      return this.gotoSlide(cur + 1)
    },
    addImpressSlide() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_add_page', { position: cur, layout: 1 })
    },
    deleteImpressSlide() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_delete_page', { slideNumber: cur }, true)
    },
    moveImpressSlide(delta) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const total = (this.impressState && this.impressState.slideCount) || 1
      const toSlide = Math.max(1, Math.min(total, cur + delta))
      if (toSlide === cur) return null
      return this.moveImpressSlideTo(toSlide)
    },
    moveImpressSlideTo(toSlide) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      if (toSlide === cur) return null
      return this.runImpressOp('slide_move_page', { slideNumber: cur, toPosition: toSlide })
    },
    applyImpressLayout(layout) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_set_layout', { slideNumber: cur, layout })
    },
    applyImpressMaster(masterName) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_set_layout', { slideNumber: cur, masterName })
    },
    applyImpressSlideSize(width, height) {
      return this.runImpressOp('set_page_setup', { width, height, orientation: 'landscape' })
    },
    insertImpressTextBox() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_add_text_box', {
        slideNumber: cur,
        text: this.$t('editor.toolbar.impressTextBox').replace(/^\+\s*/, ''),
        left: 80, top: 80, width: 320, height: 80,
      }, true)
    },
    insertImpressShape(shapeType) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_add_shape', {
        slideNumber: cur,
        shapeType,
        left: 120, top: 120, width: 180, height: shapeType === 'line' ? 4 : 120,
      }, true)
    },
    insertImpressTable(rows, cols) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_add_table', {
        slideNumber: cur,
        rows,
        cols,
        left: 60, top: 100, width: 480, height: Math.max(90, rows * 32),
      }, true)
    },
    applyImpressHyperlink() {
      const url = String(this.linkUrl || '').trim()
      if (!url) { this.impressErr = this.$t('editor.toolbar.linkRequired'); return null }
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = this.activeShapeName
      const searchText = (this.impressShape && this.impressShape.text) ? String(this.impressShape.text) : ''
      return this.runImpressOp('slide_set_hyperlink', { slideNumber: cur, shapeName, searchText, url }, true)
    },
    selectImpressShapeTarget(sh) {
      if (!sh) return null
      this.selectedShapeIndexOverride = sh.index
      this.shapeGeomForm = {
        left: sh.left != null ? sh.left : 50,
        top: sh.top != null ? sh.top : 50,
        width: sh.width != null ? sh.width : 200,
        height: sh.height != null ? sh.height : 100,
      }
      this.impressShapeTextInput = sh.text != null ? String(sh.text) : ''
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = sh.name || sh.shapeName || ''
      if (shapeName) {
        return this.call('slide_goto', { slideNumber: cur, shapeName }).then((r) => {
          this.refresh()
          return r
        })
      }
      return null
    },
    updateImpressShapeText() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = this.activeShapeName
      this.impressShapeTextFocused = false
      return this.runImpressOp('slide_set_shape_text', {
        slideNumber: cur,
        shapeName,
        text: this.impressShapeTextInput != null ? String(this.impressShapeTextInput) : '',
      })
    },
    formatImpressShape(patch) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = this.activeShapeName
      return this.runImpressOp('slide_format_shape', Object.assign({ slideNumber: cur, shapeName }, patch))
    },
    applyImpressShapeGeom() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = this.activeShapeName
      return this.runImpressOp('slide_set_shape_geometry', {
        slideNumber: cur,
        shapeName,
        left: Number(this.shapeGeomForm.left) || 0,
        top: Number(this.shapeGeomForm.top) || 0,
        width: Math.max(1, Number(this.shapeGeomForm.width) || 100),
        height: Math.max(1, Number(this.shapeGeomForm.height) || 60),
      })
    },
    deleteImpressShape() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapeName = this.activeShapeName
      this.selectedShapeIndexOverride = null
      return this.runImpressOp('slide_delete_shape', { slideNumber: cur, shapeName })
    },
    styleImpressTable(patch) {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapes = (this.impressState && this.impressState.shapes) || []
      const tbl = (this.impressShape && this.impressShape.isTable ? this.impressShape : null) || shapes.find((s) => s && s.isTable)
      const params = Object.assign({ slideNumber: cur }, patch)
      if (tbl && (tbl.name || tbl.shapeName)) params.shapeName = tbl.name || tbl.shapeName
      return this.runImpressOp('slide_table_set_style', params)
    },
    setImpressTableCell() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      const shapes = (this.impressState && this.impressState.shapes) || []
      const tbl = (this.impressShape && this.impressShape.isTable ? this.impressShape : null) || shapes.find((s) => s && s.isTable)
      const row = Math.max(0, (Number(this.impressTableCellForm.row) || 1) - 1)
      const col = Math.max(0, (Number(this.impressTableCellForm.col) || 1) - 1)
      const params = {
        slideNumber: cur,
        row,
        col,
        text: this.impressTableCellForm.text != null ? String(this.impressTableCellForm.text) : '',
      }
      if (tbl && (tbl.name || tbl.shapeName)) params.shapeName = tbl.name || tbl.shapeName
      return this.runImpressOp('slide_table_set_cell', params)
    },
    saveImpressNotes() {
      const cur = (this.impressState && this.impressState.slideNumber) || 1
      return this.runImpressOp('slide_write_notes', {
        slideNumber: cur,
        text: this.impressNotesInput != null ? String(this.impressNotesInput) : '',
      }, true)
    },
  },
}
</script>

<style scoped>
/* position:relative 只为给下面那条浮起来的查找栏当定位参照；不设 z-index，
   免得凭空造出一个会把 popStyle 的 fixed 弹层框住的层叠上下文。 */
.etb-wrap { position: relative; display: flex; flex-direction: column; flex-shrink: 0; }
.etb { display: flex; align-items: center; gap: 6px; height: 38px; padding: 0 8px; flex-shrink: 0;
  background: var(--awd-bg); border-bottom: 1px solid var(--awd-border); }
/* 查找替换条：浮在画布顶上，**不占布局高度**（dev-board#503）。占高度的话开关
   查找就会改 webview 尺寸，客体合成面会整块黑一帧。z 40 压过画布上的既有浮层
   （状态胶囊 20 / 证据投放层 25 / 改字提示条 30）。 */
/* 宽度只包住内容、靠左：工具栏横跨画布与审阅面板，铺满整行会把面板顶部那排
   修订/批注/底稿 tab 盖住；查找栏本身不到 600px，靠左浮着基本只压画布。 */
.etb-find-layer { position: absolute; top: 100%; left: 0; width: max-content; max-width: 100%; z-index: 40; }
.etb-find { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 8px; flex-shrink: 0;
  background: var(--awd-surface); border: 1px solid var(--awd-border); border-top: none;
  border-radius: 0 0 var(--awd-radius-dialog) 0; box-shadow: var(--awd-shadow-sm); }
.etb-input.fi { width: 148px; height: 26px; flex-shrink: 0; }
.etb-find-n { min-width: 62px; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); }
.etb-find-b { padding: 3px 9px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); font-size: var(--awd-panel-fs);
  color: var(--awd-text-2); flex-shrink: 0; }
.etb-find-b:hover { border-color: var(--awd-border-strong); }
.etb-find-b.on { background: var(--awd-accent-soft); border-color: var(--awd-mint); color: var(--awd-accent-text); }
.etb-find-x { margin-left: auto; padding: 3px 9px; font-size: var(--awd-panel-fs); color: var(--awd-text-2); flex-shrink: 0; }
.etb-err.bar { margin: 0; border-radius: 0; padding: 4px 10px; }
/* 4px 悬浮细滑轨：样式本体在 .awd-hairline-scroll（App.vue 全局），这里只处理
   它占的那 4px 高度。滑轨是从内容盒里扣掉的，不补偿的话主命令区会长到 26+4=30px，
   被 .etb 的 align-items:center 一居中，左半边按钮就比右侧常驻区高 2px——正是
   dev-board#502 修的那种错位。

   两个数按「行高 38、行内内容 26、滑轨 4」算，改任何一个都要重算：
   边框盒 = 26 + 4 = 30px（写成 calc(100% - 8px)，跟着 .etb 那 38px 走），
   margin-bottom:-4px 让外边距盒回到 26px，align-items:center 之后边框盒从 y6 起，
   内容盒恰好 y6..32，与右侧常驻区严丝合缝——**溢出与否都一样**。不定高的话
   （内容多高就多高）只在有滑轨时对得上，命令放得下时又会反向偏。
   行内最高的是 26px 的 .etb-btn/.etb-field/.etb-stepper（后两者靠 box-sizing:
   border-box 把 1px 边框收进 26 里，否则它们 28px 会把整行连同按钮顶低 1px，
   dev-board#543 走查实测）。
   这里刻意不设 z-index：会造出层叠上下文，把工具栏下拉那些 fixed 弹层框住（同
   .etb-wrap 那条）。 */
/* wrap 给两端渐隐提供定位参照；定高 100% 给 scroll 的百分比高度提供基准。
   它也必须居中内部 scroll：外层 .etb 的居中只作用于 wrap，普通块布局会让
   左侧按钮贴顶，比右侧常驻区高 6px（dev-board#1443）。 */
.etb-scroll-wrap { display: flex; align-items: center; flex: 1; min-width: 0; height: 100%; position: relative; }
.etb-scroll { white-space: nowrap; height: calc(100% - 8px); margin-bottom: -4px; }
.etb-row { display: flex; align-items: center; gap: 2px; }
/* 两端渐隐：宽度 16px，指向内侧（真实内容那一边）淡出，pointer-events:none 不
   挡点击。z 高于 .etb-menu/.etb-palette 的 40，避免自己的渐隐把弹层的边角盖花，
   但依然低于 popStyle 用的 fixed 弹层（900）——两者本来就不在同一层叠上下文里。 */
.etb-fade { position: absolute; top: 0; bottom: 4px; width: 16px; pointer-events: none; z-index: 41; }
.etb-fade-l { left: 0; background: linear-gradient(to right, var(--awd-bg), transparent); }
.etb-fade-r { right: 0; background: linear-gradient(to left, var(--awd-bg), transparent); }
.etb-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; padding-left: 6px;
  border-left: 1px solid var(--awd-border); }
.etb-group-t { flex-shrink: 0; padding: 0 4px; font-size: var(--awd-panel-fs-sec); color: var(--awd-text-3); }
.etb-sep { width: 1px; height: 18px; background: var(--awd-surface-3); margin: 0 5px; flex-shrink: 0; }

.etb-btn { position: relative; display: flex; align-items: center; justify-content: center; gap: 3px;
  min-width: 26px; height: 26px; padding: 0 5px; border-radius: var(--awd-radius-sm); color: var(--awd-text-2); flex-shrink: 0; }
.etb-btn:hover { background: var(--awd-surface-2); }
.etb-btn.on { background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.etb-btn.off { color: var(--awd-text-3); }
.etb-marks-trigger { margin: 0; padding: 0 var(--awd-space-1); gap: var(--awd-space-1); border: 0; background: transparent; }
.etb-marks-trigger::after, .etb-marks-menu button::after { border: 0; }
.etb-marks-trigger:focus-visible, .etb-marks-menu button:focus-visible { outline: 2px solid var(--awd-accent-text); outline-offset: 1px; }
.etb-marks-menu { box-sizing: border-box; }
.etb-marks-menu .etb-form-t { display: block; padding: var(--awd-space-1) var(--awd-space-2); }
.etb-marks-menu .etb-item { width: 100%; box-sizing: border-box; margin: 0; border: 0; background: transparent;
  color: var(--awd-text); font-size: var(--awd-font-size-body); line-height: 1.5; text-align: left; cursor: pointer; }
.etb-marks-menu .etb-item:hover { background: var(--awd-surface-2); }
.etb-marks-menu button:disabled { color: var(--awd-text-3); cursor: wait; }
.etb-btn.wide { padding: 0 9px; }
.etb-ico { width: 16px; height: 16px; display: block; }
.etb-tx { font-size: var(--awd-font-size-reading); line-height: 1; }
.etb-tx.sm { font-size: var(--awd-panel-fs); }
.etb-tx.b { font-weight: 700; }
.etb-tx.i { font-style: italic; font-family: Georgia, serif; }
.etb-tx.u { text-decoration: underline; }
.etb-tx.s { text-decoration: line-through; }
.etb-swatch { position: absolute; left: 4px; right: 4px; bottom: 3px; height: 3px; border-radius: var(--awd-radius-sm);
  border: 1px solid var(--awd-border); }

/* box-sizing:border-box：没有它，1px 边框会让边框盒变成 28px，.etb-row 跟着变 28，
   26px 的按钮在里面一居中就比右侧常驻区低 1px（dev-board#543 走查实测）。 */
.etb-field { display: flex; align-items: center; justify-content: space-between; gap: 4px; height: 26px;
  box-sizing: border-box;
  padding: 0 6px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); }
.etb-field:hover { border-color: var(--awd-border-strong); }
.etb-field.on { border-color: var(--awd-mint); background: var(--awd-accent-soft); }
.etb-field-t { font-size: var(--awd-panel-fs); color: var(--awd-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.etb-caret { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); }
.w110 { width: 110px; }
.w96 { width: 96px; }

.etb-drop { position: relative; flex-shrink: 0; }
.etb-menu { position: absolute; top: 30px; left: 0; z-index: 40; max-height: 280px;
  padding: 4px; background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md); }
.w150 { width: 150px; }
.w160 { width: 160px; }
.w180 { width: 180px; }
.w200 { width: 200px; box-sizing: border-box; }
.w240 { width: 240px; box-sizing: border-box; }
.w260 { width: 260px; box-sizing: border-box; }
.w280 { width: 280px; box-sizing: border-box; }
.w120 { width: 120px; }
.w320 { width: 320px; box-sizing: border-box; }
.etb-menu-sep { height: 1px; margin: 5px 2px; background: var(--awd-border); }
.etb-item-manage { border-bottom: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm) var(--awd-radius-sm) 0 0; margin-bottom: 3px; }
.etb-item-manage .etb-item-t { color: var(--awd-accent-text); }
.etb-step-v.pick { cursor: pointer; }
.etb-step-v.pick:hover { background: var(--awd-surface-2); }
.w72 { width: 72px; }
.etb-menu.pad { padding: 8px; }
.etb-prop-card { max-height: 440px; display: flex; flex-direction: column; gap: 6px; }
.etb-pg-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--awd-border); }
.etb-pg-subhead { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.etb-pg-title { font-size: var(--awd-font-size-body); font-weight: 600; color: var(--awd-text); letter-spacing: 0.01em; }
.etb-pg-sec { display: block; font-size: var(--awd-panel-fs-meta); font-weight: 600; color: var(--awd-text-3); padding: 1px 2px; }
.etb-pg-grid { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 6px 8px; }
.etb-pg-grid.compact { grid-template-columns: 56px 1fr; gap: 5px 6px; }
.etb-pg-l { font-size: var(--awd-panel-fs); font-weight: 500; color: var(--awd-text-2); }
.etb-pg-u { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); min-width: 14px; }
.etb-seg { display: flex; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); overflow: hidden; background: var(--awd-surface); }
.etb-seg-b { flex: 1; text-align: center; padding: 3px 6px; font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); border-right: 1px solid var(--awd-border); cursor: pointer; }
.etb-seg-b:last-child { border-right: none; }
.etb-seg-b:hover { background: var(--awd-surface-2); }
.etb-seg-b.on { background: var(--awd-accent-soft); color: var(--awd-accent-text); font-weight: 500; }
.etb-pg-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.etb-pg-chip { padding: 2px 8px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog); font-size: var(--awd-panel-fs-meta);
  color: var(--awd-text-2); background: var(--awd-surface); cursor: pointer; }
.etb-pg-chip:hover { border-color: var(--awd-mint); color: var(--awd-accent-text); }
.etb-pg-chip.on, .etb-pg-chip.ok { border-color: var(--awd-mint); background: var(--awd-accent-soft); color: var(--awd-accent-text); font-weight: 500; }
.etb-pg-swatches { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.etb-chip.on { outline: 2px solid var(--awd-mint); outline-offset: 1px; }
.etb-margin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 8px; }
.etb-margin-cell { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.etb-num { width: 64px; height: 24px; padding: 0 6px; box-sizing: border-box; font-size: var(--awd-panel-fs); color: var(--awd-text);
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); }
.etb-pg-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding-top: 2px; }
.etb-pg-acts .etb-btn { border: 1px solid var(--awd-border); background: var(--awd-surface); }
.etb-pg-acts .etb-btn:hover { border-color: var(--awd-mint); background: var(--awd-accent-soft); color: var(--awd-accent-text); }
.etb-form-b.sm { padding: 2px 8px; font-size: var(--awd-panel-fs-meta); cursor: pointer; }
.etb-item { display: flex; align-items: baseline; justify-content: space-between; gap: 6px;
  padding: 5px 8px; border-radius: var(--awd-radius-sm); }
.etb-item:hover { background: var(--awd-surface-2); }
.etb-item.on { background: var(--awd-accent-soft); }
.etb-item.dim .etb-item-t { color: var(--awd-text-3); }
.etb-item-t { font-size: var(--awd-panel-fs); color: var(--awd-text); }
.etb-hint { font-size: var(--awd-panel-fs-meta); color: var(--awd-text-3); }

.etb-form { display: flex; flex-direction: column; gap: 7px; padding: 3px 4px 1px; }
.etb-form-t { font-size: var(--awd-panel-fs); color: var(--awd-text-2); }
.etb-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 2px; }
.etb-cell { height: 15px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); }
.etb-cell.hot { background: var(--awd-accent-soft); border-color: var(--awd-mint); }
.etb-input { width: 100%; height: 28px; padding: 0 7px; box-sizing: border-box; font-size: var(--awd-panel-fs);
  color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-surface); }
.etb-input.ta { height: 58px; padding: 5px 7px; line-height: 1.45; }
.etb-form-acts { display: flex; justify-content: flex-end; gap: 6px; }
.etb-form-b { padding: 3px 11px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); font-size: var(--awd-panel-fs); color: var(--awd-text-2); }
.etb-form-b.ok { border-color: var(--awd-mint); color: var(--awd-accent-text); background: var(--awd-accent-soft); }
.etb-err { display: block; margin-top: 6px; padding: 4px 7px; border-radius: var(--awd-radius-sm);
  background: var(--awd-danger-soft); color: var(--awd-danger-text); font-size: var(--awd-panel-fs-meta); line-height: 1.4; }

.etb-palette { position: absolute; top: 30px; left: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: 5px;
  width: 128px; padding: 7px; background: var(--awd-surface); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-dialog);
  box-shadow: var(--awd-shadow-md); }
.etb-chip { width: 18px; height: 18px; border-radius: var(--awd-radius-sm); border: 1px solid var(--awd-border); }
.etb-chip.none { position: relative; }
.etb-chip.none::after { content: ''; position: absolute; left: 1px; right: 1px; top: 8px; height: 1px;
  background: var(--awd-danger); transform: rotate(-45deg); }

/* box-sizing 同 .etb-field：26px + 1px 边框 = 28px 的边框盒会成为 .etb-row 里最高的
   一件，把整行连同 26px 的按钮顶低 1px（dev-board#543 走查实测的那 1px）。 */
.etb-stepper { display: flex; align-items: center; height: 26px; box-sizing: border-box;
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm);
  background: var(--awd-surface); flex-shrink: 0; }
.etb-step-b { width: 20px; text-align: center; font-size: var(--awd-font-size-reading); color: var(--awd-text-2); line-height: 24px; }
.etb-step-b:hover { color: var(--awd-accent-text); background: var(--awd-surface-2); }
.etb-step-v { min-width: 34px; text-align: center; font-size: var(--awd-panel-fs); color: var(--awd-text); }
.etb-step-v.z { min-width: 42px; }
.w84 { width: 84px; }
.etb-inline-row { display: flex; align-items: center; gap: 6px; }
.etb-inline-row .etb-input { flex: 1; min-width: 0; }
.etb-pg-chip.danger, .etb-form-b.danger { border-color: var(--awd-danger); color: var(--awd-danger-text); background: var(--awd-danger-soft); }
.etb-calc-bar { display: flex; align-items: center; gap: 5px; height: 30px; padding: 0 8px; flex-shrink: 0;
  background: var(--awd-surface); border-bottom: 1px solid var(--awd-border); }
.etb-calc-sheet-tabs { display: flex; align-items: center; gap: 3px; max-width: 240px; overflow-x: auto; flex-shrink: 0; }
.etb-calc-sheet-tab { padding: 2px 8px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm);
  background: var(--awd-bg); font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.etb-calc-sheet-tab:hover { border-color: var(--awd-mint); color: var(--awd-accent-text); }
.etb-calc-sheet-tab.on { border-color: var(--awd-mint); background: var(--awd-accent-soft); color: var(--awd-accent-text); font-weight: 600; }
.etb-calc-sheet-pill { display: flex; align-items: center; justify-content: center; gap: 4px; height: 22px; padding: 0 6px;
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-bg); cursor: pointer; flex-shrink: 0; }
.etb-calc-sheet-pill:hover { border-color: var(--awd-mint); color: var(--awd-accent-text); }
.etb-calc-sheet-name { font-size: var(--awd-panel-fs-meta); font-weight: 600; color: var(--awd-text); max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.etb-calc-sheet-add { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px;
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); font-size: var(--awd-panel-fs); color: var(--awd-text-2); cursor: pointer; flex-shrink: 0; }
.etb-calc-sheet-add:hover { border-color: var(--awd-mint); color: var(--awd-accent-text); background: var(--awd-accent-soft); }
.etb-calc-name-box { width: 72px; height: 22px; padding: 0 6px; box-sizing: border-box; font-size: var(--awd-panel-fs-meta); font-family: monospace;
  color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-bg); flex-shrink: 0; text-align: center; }
.etb-calc-fx { font-size: var(--awd-panel-fs-meta); font-style: italic; font-weight: 600; font-family: Georgia, serif; color: var(--awd-text-3); padding: 0 2px; flex-shrink: 0; }
.etb-calc-fx-btn { display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); background: var(--awd-bg); cursor: pointer; flex-shrink: 0; }
.etb-calc-fx-btn:hover { border-color: var(--awd-mint); color: var(--awd-accent-text); }
.etb-calc-fx-btn.ok:hover { background: var(--awd-accent-soft); }
.etb-calc-formula-input { flex: 1; min-width: 80px; height: 22px; padding: 0 8px; box-sizing: border-box; font-size: var(--awd-panel-fs);
  color: var(--awd-text); border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm); background: var(--awd-bg); }
.etb-calc-fn-chips { display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.etb-calc-fn-chip { padding: 1px 6px; border: 1px solid var(--awd-border); border-radius: var(--awd-radius-sm);
  background: var(--awd-bg); font-size: var(--awd-panel-fs-meta); color: var(--awd-text-2); cursor: pointer; white-space: nowrap; }
.etb-calc-fn-chip:hover { border-color: var(--awd-mint); background: var(--awd-accent-soft); color: var(--awd-accent-text); }
</style>
