package cc.ginpika.rukksh.web.support;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

class ChatAttachmentParserTest {
    @Test
    void extractsPdfWordAndUtf8AndConvertsAnImageToModelData() throws IOException {
        var image = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(2, 3, BufferedImage.TYPE_INT_RGB), "png", image);
        var files = ChatAttachmentParser.read(List.of(
                upload("preview.PNG", image.toByteArray()),
                upload("notes.pdf", pdf()),
                upload("测试.docx", docx("""
                        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                          <w:body><w:p><w:r><w:t>计划正文</w:t></w:r></w:p></w:body>
                        </w:document>
                        """)),
                upload("table.csv", "\uFEFF名称,数量\n苹果,2".getBytes(StandardCharsets.UTF_8))));
        assertTrue(files.get(0).value().startsWith("data:image/png;base64,"));
        assertEquals("Fixture PDF text", files.get(1).value());
        assertEquals("计划正文", files.get(2).value());
        assertEquals("名称,数量\n苹果,2", files.get(3).value());
    }

    @Test
    void rejectsUnsupportedSpoofedAndOverlongAttachments() {
        byte[] text = "text".getBytes(StandardCharsets.UTF_8);
        assertThrows(IllegalArgumentException.class, () -> ChatAttachmentParser.read(List.of(upload("file.exe", text))));
        assertThrows(IllegalArgumentException.class, () -> ChatAttachmentParser.read(List.of(upload("file.png", text))));
        assertThrows(IllegalArgumentException.class, () -> ChatAttachmentParser.read(List.of(
                upload("one.md", "a".repeat(12_001).getBytes(StandardCharsets.UTF_8)),
                upload("two.txt", "b".repeat(12_000).getBytes(StandardCharsets.UTF_8)))));
    }

    @Test
    void rejectsWordDocumentsWithADoctype() throws IOException {
        byte[] document = docx("""
                <!DOCTYPE w:document>
                <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:body><w:p><w:r><w:t>Fixture</w:t></w:r></w:p></w:body>
                </w:document>
                """);
        assertThrows(IllegalArgumentException.class, () -> ChatAttachmentParser.read(List.of(upload("invalid.docx", document))));
    }

    private static MockMultipartFile upload(String name, byte[] bytes) {
        return new MockMultipartFile("files", name, "application/octet-stream", bytes);
    }

    private static byte[] docx(String xml) throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            zip.putNextEntry(new ZipEntry("word/document.xml"));
            zip.write(xml.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
        return bytes.toByteArray();
    }

    private static byte[] pdf() throws IOException {
        var bytes = new ByteArrayOutputStream();
        try (var document = new PDDocument()) {
            var page = new PDPage();
            document.addPage(page);
            try (var content = new PDPageContentStream(document, page)) {
                content.beginText();
                content.setFont(new PDType1Font(Standard14Fonts.FontName.HELVETICA), 12);
                content.newLineAtOffset(40, 750);
                content.showText("Fixture PDF text");
                content.endText();
            }
            document.save(bytes);
        }
        return bytes.toByteArray();
    }
}
