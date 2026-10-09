import { attr, descendants, relationships, requiredXml, textNodes, type ModelBuilder, type Pkg } from "./ooxml";

// PPTX extraction (plan U3). A segment's `node` is the node's index in
// textNodes(part, ["a:t"]); legacy comment parts use ["p:text"] instead.

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

export async function extractPptx(pkg: Pkg, builder: ModelBuilder): Promise<void> {
  const presentation = await requiredXml(pkg, "ppt/presentation.xml");
  const presentationRels = await relationships(pkg, "ppt/presentation.xml");

  /** One flow item per paragraph that has text. */
  const emitParagraphs = async (part: string, title: string, hidden: boolean) => {
    const document = await pkg.xml(part);

    if (!document) {
      return;
    }

    const index = new Map(textNodes(document, ["a:t"]).map((node, at) => [node, at]));
    const section = builder.section(title, "flow", hidden);

    for (const paragraph of descendants(document, "p")) {
      const pieces = textNodes(paragraph, ["a:t"]).map((node) => ({ text: node.textContent ?? "", part, node: index.get(node) ?? -1 }));

      builder.item(section, title, null, null, pieces);
    }
  };

  const slides = descendants(presentation, "sldId").map((slide, at) => ({
    n: at + 1,
    id: attr(slide, "id") ?? String(at + 1),
    part: presentationRels.find((rel) => rel.id === attr(slide, "r:id"))?.target ?? "",
  }));

  const notes: { n: number; part: string; hidden: boolean }[] = [];

  for (const slide of slides) {
    const document = await requiredXml(pkg, slide.part);
    const hidden = document.documentElement?.getAttribute("show") === "0";

    await emitParagraphs(slide.part, `Slide ${slide.n}`, hidden);

    if (hidden) {
      builder.hide({
        id: `slide-${slide.id}`,
        kind: "hidden-slide",
        note: `Hidden slide ${slide.n}`,
        quote: null,
        category: "hidden-data",
      });
    }

    const notesPart = (await relationships(pkg, slide.part)).find((rel) => rel.type.endsWith("/notesSlide"))?.target;

    if (notesPart) {
      notes.push({ n: slide.n, part: notesPart, hidden });
    }
  }

  for (const note of notes) {
    await emitParagraphs(note.part, `Slide ${note.n} notes`, note.hidden);
  }

  for (const part of pkg.names.filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/.test(name)).sort(natural)) {
    const name = descendants(await requiredXml(pkg, part), "cSld")[0]?.getAttribute("name") || part;

    await emitParagraphs(part, `Layout: ${name}`, false);
  }

  const masters = pkg.names.filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name)).sort(natural);

  for (const [at, part] of masters.entries()) {
    await emitParagraphs(part, `Master ${at + 1}`, false);
  }

  // Comments: legacy (authors in commentAuthors.xml) and modern (authors.xml).
  const authorNames = new Map<string, string>();

  for (const [part, tag] of [
    ["ppt/commentAuthors.xml", "cmAuthor"],
    ["ppt/authors.xml", "author"],
  ]) {
    const document = await pkg.xml(part);

    for (const author of document ? descendants(document, tag) : []) {
      authorNames.set(attr(author, "id") ?? "", attr(author, "name") ?? "");
    }
  }

  const comments = builder.section("Comments", "flow");

  for (const part of pkg.names.filter((name) => /^ppt\/comments\/[^/]+\.xml$/.test(name))) {
    const document = await requiredXml(pkg, part);
    const names = part.includes("modernComment") ? ["a:t"] : ["p:text"];
    const index = new Map(textNodes(document, names).map((node, at) => [node, at]));
    const authors: string[] = [];

    for (const comment of descendants(document, "cm")) {
      const author = authorNames.get(attr(comment, "authorId") ?? "") ?? "unknown author";
      const pieces = textNodes(comment, names).map((node) => ({ text: node.textContent ?? "", part, node: index.get(node) ?? -1 }));

      authors.push(author);
      builder.item(comments, `Comment by ${author}`, null, null, pieces);
    }

    const unique = [...new Set(authors)];

    builder.hide({
      id: `comments-${part}`,
      kind: "comment",
      note: unique.length > 0 ? `Comments by ${unique.join(", ")}` : "Comments",
      quote: unique[0] ?? null,
      category: "hidden-data",
    });
  }
}
