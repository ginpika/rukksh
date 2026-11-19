package cc.ginpika.rukksh.web.controller;

import cc.ginpika.rukksh.agent.chat.ChatAttachments;
import cc.ginpika.rukksh.agent.chat.ChatAttachments.Content;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.Writer;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamException;
import org.apache.commons.compress.archivers.zip.ZipFile;
import org.apache.commons.compress.utils.SeekableInMemoryByteChannel;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.io.IOUtils;
import org.apache.pdfbox.io.RandomAccessReadBuffer;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.web.multipart.MultipartFile;

/** Upload allowlist and bounded extraction for material supplied with a chat turn. */
final class ChatAttachmentUpload {
    private static final int MAX_FILES = 4;
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static final int MAX_DOCUMENT_CHARS = 24_000;
    private static final int MAX_WORD_XML_BYTES = 4 * 1024 * 1024;
    private static final String WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static final String STRICT_WORD_NAMESPACE = "http://purl.oclc.org/ooxml/wordprocessingml/main";

    private ChatAttachmentUpload() {}

    static List<Content> read(List<MultipartFile> uploads) {
        if (uploads.isEmpty() || uploads.size() > MAX_FILES) {
            throw new IllegalArgumentException("每条消息可添加 1–4 个附件");
        }
        if (uploads.stream().mapToLong(MultipartFile::getSize).sum() > MAX_BYTES) {
            throw new IllegalArgumentException("附件总大小不能超过 4 MB");
        }
        int imageCount = 0;
        int documentChars = 0;
        var files = new ArrayList<Content>();
        for (MultipartFile upload : uploads) {
            String name = safeName(upload.getOriginalFilename());
            String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
            if (upload.isEmpty()) throw new IllegalArgumentException("文件为空：" + name);
            try {
                byte[] data = upload.getBytes();
                String mime = switch (extension) {
                    case "png" -> "image/png";
                    case "jpg", "jpeg" -> "image/jpeg";
                    case "gif" -> "image/gif";
                    default -> null;
                };
                if (mime != null) {
                    if (++imageCount > ChatAttachments.MAX_IMAGES) {
                        throw new IllegalArgumentException("每条消息最多可添加 2 张图片");
                    }
                    files.add(new Content(name, mime, imageData(mime, data)));
                    continue;
                }
                int remaining = MAX_DOCUMENT_CHARS - documentChars;
                String document = switch (extension) {
                    case "pdf" -> pdfText(data, remaining);
                    case "docx" -> wordText(data, remaining);
                    case "txt", "md", "markdown", "csv" -> plainText(data);
                    default -> throw new IllegalArgumentException("不支持的附件格式：" + name);
                };
                if (document.isBlank()) {
                    throw new IllegalArgumentException("没有可读取的文字：" + name + "。扫描件可尝试上传图片。");
                }
                documentChars += document.length();
                if (documentChars > MAX_DOCUMENT_CHARS) throw new DocumentTooLong();
                files.add(new Content(name, "text/plain", document));
            } catch (DocumentTooLong e) {
                throw new IllegalArgumentException("附件正文合计不能超过 24,000 字符，请先截取所需部分");
            } catch (IOException | XMLStreamException e) {
                throw new IllegalArgumentException("无法读取附件：" + name + "。请检查文件格式、编码或加密状态。", e);
            }
        }
        return List.copyOf(files);
    }

    private static String safeName(String value) {
        String path = value == null ? "" : value.replace('\\', '/');
        String name = path.substring(path.lastIndexOf('/') + 1).replaceAll("\\p{Cntrl}", "").strip();
        if (name.length() > 240 || name.lastIndexOf('.') <= 0) {
            throw new IllegalArgumentException("附件需要有效的文件名和扩展名");
        }
        return name;
    }

    private static String imageData(String mime, byte[] data) throws IOException {
        try (var stream = new MemoryCacheImageInputStream(new ByteArrayInputStream(data))) {
            var readers = ImageIO.getImageReaders(stream);
            if (!readers.hasNext()) throw new IOException("Invalid image");
            var reader = readers.next();
            try {
                reader.setInput(stream, true, true);
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (!mime.equals("image/" + reader.getFormatName().toLowerCase(Locale.ROOT))
                        || width <= 0 || height <= 0 || width > 8192 || height > 8192
                        || (long) width * height > 32_000_000) {
                    throw new IOException("Invalid image type or dimensions");
                }
            } finally {
                reader.dispose();
            }
        }
        return "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(data);
    }

    private static String plainText(byte[] data) throws IOException {
        String text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(data)).toString();
        if (text.chars().anyMatch(c -> Character.isISOControl(c) && c != '\n' && c != '\r' && c != '\t')) {
            throw new IOException("Invalid plain text");
        }
        return (text.startsWith("\uFEFF") ? text.substring(1) : text).strip();
    }

    private static String pdfText(byte[] data, int limit) throws IOException {
        try (var source = new RandomAccessReadBuffer(data);
                var pdf = Loader.loadPDF(source, IOUtils.createTempFileOnlyStreamCache())) {
            if (pdf.isEncrypted()) throw new IOException("Encrypted PDF");
            if (pdf.getNumberOfPages() > 100) {
                throw new IllegalArgumentException("单个 PDF 最多支持 100 页，请先截取所需页面");
            }
            BoundedText text = new BoundedText(limit);
            new PDFTextStripper().writeText(pdf, text);
            return text.value();
        }
    }

    private static String wordText(byte[] data, int limit) throws IOException, XMLStreamException {
        // Read only the main document part. Other ZIP members, external references and DTDs are never expanded.
        try (var zip = ZipFile.builder().setSeekableByteChannel(new SeekableInMemoryByteChannel(data)).get()) {
            var document = zip.getEntry("word/document.xml");
            if (document == null || document.getSize() > MAX_WORD_XML_BYTES) throw new IOException("Invalid DOCX");
            try (var stream = zip.getInputStream(document)) {
                byte[] xml = stream.readNBytes(MAX_WORD_XML_BYTES + 1);
                if (xml.length > MAX_WORD_XML_BYTES) throw new IOException("DOCX XML exceeds size limit");
                return wordXmlText(xml, limit);
            }
        }
    }

    private static String wordXmlText(byte[] xml, int limit) throws IOException, XMLStreamException {
        var factory = XMLInputFactory.newFactory();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        factory.setProperty(XMLInputFactory.IS_SUPPORTING_EXTERNAL_ENTITIES, false);
        var reader = factory.createXMLStreamReader(new ByteArrayInputStream(xml));
        BoundedText text = new BoundedText(limit);
        try {
            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.DTD) throw new XMLStreamException("DOCX must not contain a DTD");
                if (event != XMLStreamConstants.START_ELEMENT && event != XMLStreamConstants.END_ELEMENT) continue;
                String namespace = reader.getNamespaceURI();
                if (!WORD_NAMESPACE.equals(namespace) && !STRICT_WORD_NAMESPACE.equals(namespace)) continue;
                String tag = reader.getLocalName();
                if (event == XMLStreamConstants.START_ELEMENT) {
                    switch (tag) {
                        case "t" -> text.append(reader.getElementText());
                        case "tab" -> text.append("\t");
                        case "br", "cr" -> text.append("\n");
                        default -> { }
                    }
                } else if ("p".equals(tag)) {
                    text.append("\n");
                }
            }
            return text.value();
        } finally {
            reader.close();
        }
    }

    private static final class DocumentTooLong extends IOException {}

    private static final class BoundedText extends Writer {
        private final StringBuilder result = new StringBuilder();
        private final int limit;

        BoundedText(int limit) {
            this.limit = limit;
        }

        private void ensureSpace(int length) throws DocumentTooLong {
            if (length > limit - result.length()) throw new DocumentTooLong();
        }

        void append(String text) throws DocumentTooLong {
            ensureSpace(text.length());
            result.append(text);
        }

        @Override
        public void write(char[] data, int from, int length) throws IOException {
            ensureSpace(length);
            result.append(data, from, length);
        }

        String value() { return result.toString().strip(); }
        @Override public void flush() {}
        @Override public void close() {}
    }
}
