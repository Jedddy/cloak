import { describe, expect, test } from "bun:test";

import { buildDocx, buildPptx } from "./fixtures/ooxml";
import { extractOoxml, loadPackage, ooxmlImages, parseXml, serializeXml, textNodes } from "./ooxml";

describe("ooxml", () => {
  test("a corrupt zip throws a readable error", async () => {
    const bytes = new TextEncoder().encode("this is not a zip");

    await expect(extractOoxml({ fileName: "a.docx", format: "docx", bytes })).rejects.toThrow("The document cannot be read.");
  });

  test("corrupt XML throws the same error", async () => {
    const good = await loadPackage(await buildDocx({ paragraphs: ["x"] }));

    good.zip.file("word/document.xml", "<w:document><w:body></w:document>");

    const bytes = await good.zip.generateAsync({ type: "uint8array" });

    await expect(extractOoxml({ fileName: "a.docx", format: "docx", bytes })).rejects.toThrow("The document cannot be read.");
  });

  test("textNodes returns matching elements in document order and survives a serialize round trip", () => {
    const xml = '<w:p xmlns:w="urn:w"><w:r><w:t>a</w:t></w:r><w:r><w:delText>b</w:delText></w:r><w:r><w:t>c</w:t></w:r></w:p>';
    const document = parseXml(xml);

    expect(textNodes(document, ["w:t", "w:delText"]).map((node) => node.textContent)).toEqual(["a", "b", "c"]);
    expect(textNodes(parseXml(serializeXml(document)), ["w:t", "w:delText"]).map((node) => node.textContent)).toEqual(["a", "b", "c"]);
  });

  test("ooxmlImages returns the bytes of each model image", async () => {
    const bytes = await buildDocx({ image: true });
    const input = { fileName: "a.docx", format: "docx" as const, bytes };
    const model = await extractOoxml(input);
    const images = await ooxmlImages({ ...input, model });

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ id: "word/media/image1.png", mime: "image/png" });
    expect([...images[0].bytes.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test("a signature part sets signed", async () => {
    const pkg = await loadPackage(await buildPptx({ slides: [{ texts: ["x"] }] }));

    pkg.zip.file("_xmlsignatures/sig1.xml", "<Signature/>");

    const bytes = await pkg.zip.generateAsync({ type: "uint8array" });
    const model = await extractOoxml({ fileName: "a.pptx", format: "pptx", bytes });

    expect(model.signed).toBe(true);
  });
});
