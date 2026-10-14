import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeFileMeta } from '../fileMeta';

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Old Title</dc:title>
    <dc:creator opf:role="aut">Old Author</dc:creator>
    <meta property="belongs-to-collection" id="col">Old Series</meta>
    <meta refines="#col" property="group-position">2</meta>
    <dc:language>fr</dc:language>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml"/></manifest>
</package>`;

const makeEpub = (opf: string = OPF): Uint8Array =>
  zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8('<html/>'),
  });

const opfOf = (bytes: Uint8Array): string => {
  const files = unzipSync(bytes);
  const container = strFromU8(files['META-INF/container.xml']!);
  const opfPath = /full-path="([^"]+)"/.exec(container)![1]!;
  return strFromU8(files[opfPath]!);
};

describe('writeFileMeta — epub', () => {
  it('rewrites dc:title and dc:creator in the OPF, keeping every other file', () => {
    const out = writeFileMeta('epub', makeEpub(), { title: 'New Title', author: 'New Author', series: null, seriesIndex: null })!;
    const files = unzipSync(out);
    expect(opfOf(out)).toContain('<dc:title>New Title</dc:title>');
    expect(opfOf(out)).toContain('<dc:creator opf:role="aut">New Author</dc:creator>');
    expect(opfOf(out)).toContain('<dc:language>fr</dc:language>');
    expect(strFromU8(files['OEBPS/nav.xhtml']!)).toBe('<html/>');
    expect(strFromU8(files.mimetype!)).toBe('application/epub+zip');
  });

  it('keeps mimetype as the first zip entry (EPUB spec)', () => {
    const out = writeFileMeta('epub', makeEpub(), { title: 'T', author: null, series: null, seriesIndex: null })!;
    expect(Object.keys(unzipSync(out))[0]).toBe('mimetype');
  });

  it('inserts dc:creator when the OPF has none', () => {
    const noCreator = OPF.replace(/<dc:creator[^>]*>[^<]*<\/dc:creator>/, '');
    const out = writeFileMeta('epub', makeEpub(noCreator), { title: 'T', author: 'Inserted Author', series: null, seriesIndex: null })!;
    expect(opfOf(out)).toContain('<dc:creator>Inserted Author</dc:creator>');
    expect(opfOf(out)).toContain('<dc:title>T</dc:title>');
  });

  it('xml-escapes the written values', () => {
    const out = writeFileMeta('epub', makeEpub(), { title: 'A & B <C> "D"', author: null, series: null, seriesIndex: null })!;
    expect(opfOf(out)).toContain('<dc:title>A &amp; B &lt;C&gt; &quot;D&quot;</dc:title>');
  });

  it('updates the EPUB3 collection meta when the file already carries a series', () => {
    const out = writeFileMeta('epub', makeEpub(), { title: 'T', author: null, series: 'New Series', seriesIndex: 3, })!;
    expect(opfOf(out)).toContain('>New Series</meta>');
    expect(opfOf(out)).toContain('>3</meta>');
  });

  it('removes the collection meta when the series is cleared', () => {
    const out = writeFileMeta('epub', makeEpub(), { title: 'T', author: null, series: null, seriesIndex: null })!;
    expect(opfOf(out)).not.toContain('belongs-to-collection');
    expect(opfOf(out)).not.toContain('group-position');
  });

  it('leaves the series untouched when the file has no collection meta', () => {
    const noSeries = OPF.replace(/\s*<meta property="belongs-to-collection"[\s\S]*?<\/meta>/, '').replace(/\s*<meta refines="#col"[\s\S]*?<\/meta>/, '');
    const out = writeFileMeta('epub', makeEpub(noSeries), { title: 'T', author: null, series: 'Some Series', seriesIndex: 1 })!;
    expect(opfOf(out)).not.toContain('Some Series');
  });
});

describe('writeFileMeta — cbz', () => {
  const makeCbz = (comicInfo?: string): Uint8Array => {
    const files: Record<string, Uint8Array> = { 'page-1.jpg': new Uint8Array([0xff, 0xd8]) };
    if (comicInfo) files['ComicInfo.xml'] = strToU8(comicInfo);
    return zipSync(files);
  };

  it('creates a minimal ComicInfo.xml when absent', () => {
    const out = writeFileMeta('cbz', makeCbz(), { title: 'T1', author: null, series: 'Saga', seriesIndex: 4 })!;
    const info = strFromU8(unzipSync(out)['ComicInfo.xml']!);
    expect(info).toContain('<Title>T1</Title>');
    expect(info).toContain('<Series>Saga</Series>');
    expect(info).toContain('<Number>4</Number>');
    expect(info).not.toContain('<Title>undefined');
  });

  it('updates Title/Series/Number and preserves the other fields', () => {
    const info = `<?xml version="1.0"?><ComicInfo><Title>Old</Title><Series>Old S</Series><Number>1</Number><Writer>Real Writer</Writer><PageCount>22</PageCount></ComicInfo>`;
    const out = writeFileMeta('cbz', makeCbz(info), { title: 'New', author: null, series: 'New S', seriesIndex: 2.5 })!;
    const updated = strFromU8(unzipSync(out)['ComicInfo.xml']!);
    expect(updated).toContain('<Title>New</Title>');
    expect(updated).toContain('<Series>New S</Series>');
    expect(updated).toContain('<Number>2.5</Number>');
    expect(updated).toContain('<Writer>Real Writer</Writer>');
    expect(updated).toContain('<PageCount>22</PageCount>');
  });

  it('drops Number when the volume is cleared', () => {
    const info = `<ComicInfo><Title>Old</Title><Series>S</Series><Number>1</Number></ComicInfo>`;
    const out = writeFileMeta('cbz', makeCbz(info), { title: 'New', author: null, series: 'S', seriesIndex: null })!;
    const updated = strFromU8(unzipSync(out)['ComicInfo.xml']!);
    expect(updated).toContain('<Series>S</Series>');
    expect(updated).not.toContain('<Number>');
  });

  it('keeps image entries intact', () => {
    const out = writeFileMeta('cbz', makeCbz(), { title: 'T', author: null, series: null, seriesIndex: null })!;
    expect(unzipSync(out)['page-1.jpg']).toEqual(new Uint8Array([0xff, 0xd8]));
  });
});

describe('writeFileMeta — unsupported formats', () => {
  it('returns null for mobi and azw3 (binary formats are read-only)', () => {
    expect(writeFileMeta('mobi', new Uint8Array(8), { title: 'T', author: null, series: null, seriesIndex: null })).toBeNull();
    expect(writeFileMeta('azw3', new Uint8Array(8), { title: 'T', author: null, series: null, seriesIndex: null })).toBeNull();
  });
});
