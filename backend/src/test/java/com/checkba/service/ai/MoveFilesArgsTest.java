// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package com.checkba.service.ai;

import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.checkba.service.ai.tools.AgentToolComponent;
import com.checkba.service.ai.tools.MoveFilesArgs;
import com.checkba.service.ai.tools.ToolContext;
import dev.langchain4j.agent.tool.P;
import dev.langchain4j.agent.tool.Tool;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** eval t06：模型自造 sources/destinations 等形状时，move_files 要能读懂；读不懂要给出正确写法。 */
class MoveFilesArgsTest {

    private static List<MoveFilesArgs.Move> folded(String argsJson) {
        JSONObject args = JSONUtil.parseObj(argsJson);
        MoveFilesArgs.fold(args);
        return MoveFilesArgs.parse(args.getStr("movesJson"));
    }

    private static final List<MoveFilesArgs.Move> TWO = List.of(
            new MoveFilesArgs.Move("a.docx", "01/a.docx"), new MoveFilesArgs.Move("b.docx", "02/b.docx"));

    @Test
    @DisplayName("sources/destinations 两个并行数组（t06 实况）")
    void parallelArrays() {
        assertEquals(TWO, folded("{\"sources\":[\"a.docx\",\"b.docx\"],\"destinations\":[\"01/a.docx\",\"02/b.docx\"]}"));
    }

    @Test
    @DisplayName("sources/destinations 写成逗号分隔字符串（t06 实况）")
    void commaStrings() {
        assertEquals(TWO, folded("{\"sources\":\"a.docx,b.docx\",\"destinations\":\"01/a.docx,02/b.docx\"}"));
    }

    @Test
    @DisplayName("sources + 单个 destination = 目标文件夹，保留原名")
    void singleDestinationFolder() {
        assertEquals(List.of(new MoveFilesArgs.Move("x/a.docx", "归档/a.docx"), new MoveFilesArgs.Move("b.docx", "归档/b.docx")),
                folded("{\"sources\":[\"x/a.docx\",\"b.docx\"],\"destination\":\"归档/\"}"));
    }

    @Test
    @DisplayName("files=[{source,destination}] 与 moves=[{from,to}]")
    void listOfObjectsWithSynonymKeys() {
        assertEquals(TWO, folded("{\"files\":[{\"source\":\"a.docx\",\"destination\":\"01/a.docx\"},{\"source\":\"b.docx\",\"destination\":\"02/b.docx\"}]}"));
        assertEquals(TWO, folded("{\"moves\":[{\"from\":\"a.docx\",\"to\":\"01/a.docx\"},{\"from\":\"b.docx\",\"to\":\"02/b.docx\"}]}"));
    }

    @Test
    @DisplayName("movesJson 内部用同义键、或外层包一个对象")
    void movesJsonWithSynonymKeys() {
        assertEquals(TWO, MoveFilesArgs.parse("[{\"from\":\"a.docx\",\"to\":\"01/a.docx\"},{\"src\":\"b.docx\",\"dest\":\"02/b.docx\"}]"));
        assertEquals(TWO, MoveFilesArgs.parse("{\"moves\":[{\"sourcePath\":\"a.docx\",\"destPath\":\"01/a.docx\"},{\"sourcePath\":\"b.docx\",\"destPath\":\"02/b.docx\"}]}"));
    }

    @Test
    @DisplayName("已有 movesJson 不被覆盖")
    void existingMovesJsonWins() {
        JSONObject args = JSONUtil.parseObj("{\"movesJson\":\"[]\",\"sources\":[\"a\"],\"destinations\":[\"b\"]}");
        MoveFilesArgs.fold(args);
        assertEquals("[]", args.getStr("movesJson"));
    }

    @Test
    @DisplayName("数量对不上不猜：不折叠，由 move_files 报错")
    void mismatchedCountsAreNotGuessed() {
        JSONObject args = JSONUtil.parseObj("{\"sources\":[\"a\",\"b\",\"c\"],\"destinations\":[\"x\",\"y\"]}");
        MoveFilesArgs.fold(args);
        assertNull(args.getStr("movesJson"));
    }

    @Test
    @DisplayName("读不懂时报错里带正确写法")
    void errorShowsCorrectShape() {
        for (String bad : new String[]{"这不是 JSON", "\"字符串\"", "[\"a.docx\"]"}) {
            IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> MoveFilesArgs.parse(bad), bad);
            assertTrue(e.getMessage().startsWith("Error:"), e.getMessage());
            assertTrue(e.getMessage().contains("\"sourcePath\"") && e.getMessage().contains("\"destPath\""), e.getMessage());
        }
    }

    // ---- 经 XML 兜底解析 + ToolRegistry 分发的端到端 ----

    static class Recorder implements AgentToolComponent {
        String seen;

        @Tool("move")
        public String move_files(@P("moves") String movesJson) {
            seen = movesJson;
            return "ok";
        }
    }

    private String dispatch(String content) {
        Recorder rec = new Recorder();
        ToolRegistry registry = new ToolRegistry(List.of(rec), new PluginService(), new ClientCapabilityService());
        registry.init();
        List<XmlToolCallParser.ParsedCall> calls = new XmlToolCallParser(registry).parse(XmlToolCallParser.normalizeLeakedClosers(content));
        assertEquals(1, calls.size());
        assertNull(calls.get(0).parseError(), String.valueOf(calls.get(0).parseError()));
        var result = registry.execute(calls.get(0).toolName(), calls.get(0).argsJson(), new ToolContext(5L, "c", 7L, null));
        assertNotNull(rec.seen, String.valueOf(result) + " args=" + calls.get(0).argsJson());
        return rec.seen;
    }

    @Test
    @DisplayName("XML：move_files(sources=[...], destinations=[...]) 不再被判未知参数")
    void xmlParallelArrays() {
        String seen = dispatch("<tool_code>move_files(sources=[\"a.docx\",\"b.docx\"], destinations=[\"01/a.docx\",\"02/b.docx\"])</tool_code>");
        assertEquals(TWO, MoveFilesArgs.parse(seen));
    }

    @Test
    @DisplayName("XML：files=[{source,destination}] 与泄漏的 DSML 收尾标签")
    void xmlObjectListWithLeakedDsmlTail() {
        String seen = dispatch("<tool_code>move_files(files=[{\"source\":\"a.docx\",\"destination\":\"01/a.docx\"},"
                + "{\"source\":\"b.docx\",\"destination\":\"02/b.docx\"}])</｜DSML｜tool_calls>");
        assertEquals(TWO, MoveFilesArgs.parse(seen));
    }

    @Test
    @DisplayName("XML：sources=\"a,b\", destination=\"归档\"")
    void xmlFolder() {
        String seen = dispatch("<tool_code>move_files(sources=\"a.docx,b.docx\", destination=\"归档\")</tool_code>");
        assertEquals(List.of(new MoveFilesArgs.Move("a.docx", "归档/a.docx"), new MoveFilesArgs.Move("b.docx", "归档/b.docx")),
                MoveFilesArgs.parse(seen));
    }
}
