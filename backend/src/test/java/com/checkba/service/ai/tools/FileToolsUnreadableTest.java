// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package com.checkba.service.ai.tools;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import org.apache.tika.exception.EncryptedDocumentException;
import org.apache.tika.exception.TikaException;
import org.junit.jupiter.api.Test;

/**
 * D32 (robustness-20 r14): a corrupt docx made extract_file_text return the raw parser exception
 * ("TIKA-198: Illegal IOException from ...PackageParser"); the model quoted it to the lawyer and kept
 * trying other tools. Parser failures now map to a plain, final message.
 */
class FileToolsUnreadableTest {

    @Test
    void corruptPackageBecomesAPlainFinalMessage() {
        // the shape ProjectFileTextExtractor actually throws: IOException wrapping a TikaException
        IOException e = new IOException("TIKA-198: Illegal IOException from org.apache.tika.parser.pkg.PackageParser@1",
                new TikaException("TIKA-198: Illegal IOException from org.apache.tika.parser.pkg.PackageParser@1"));
        String msg = FileTools.unreadableFileMessage(e);
        assertNotNull(msg);
        assertEquals(AttachmentMessages.error("fileUnreadable"), msg);
        assertFalse(msg.contains("TIKA"), msg);
        assertFalse(msg.contains("Exception"), msg);
    }

    @Test
    void zipDamageIsUnreadableToo() {
        assertEquals(AttachmentMessages.error("fileUnreadable"),
                FileTools.unreadableFileMessage(new IOException("x", new java.util.zip.ZipException("invalid LOC header"))));
    }

    @Test
    void passwordProtectedFilesSaySo() {
        IOException e = new IOException("enc", new EncryptedDocumentException("Unable to process: document is encrypted"));
        assertEquals(AttachmentMessages.error("fileEncrypted"), FileTools.unreadableFileMessage(e));
    }

    @Test
    void otherFailuresAreNotRelabelled() {
        // storage / permission problems are not "the file is damaged"
        assertNull(FileTools.unreadableFileMessage(new IOException("No space left on device")));
        assertNull(FileTools.unreadableFileMessage(new SecurityException("denied")));
    }
}
