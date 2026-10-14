import { parseSidecar, serializeSidecar } from '../koreaderSidecar';

const typical = `return {
    ["cache_file_path"] = "/path/to/book.epub",
    ["doc_props"] = {
        ["authors"] = "A. Christie",
        ["language"] = "en",
        ["title"] = "Ten Little \\\"Men\\\""
    },
    ["percent_finished"] = 0.4231,
    ["last_read"] = 1699999999,
    ["summary"] = {
        ["modified"] = "1699999999.000",
        ["status"] = "reading"
    }
}
`;

describe('parseSidecar', () => {
  it('reads percent, last_read and doc_props from a KOReader metadata file', () => {
    expect(parseSidecar(typical)).toEqual({
      percentFinished: 0.4231,
      lastRead: 1699999999,
      title: 'Ten Little "Men"',
      authors: 'A. Christie',
      language: 'en',
    });
  });

  it('tolerates a file without doc_props or last_read', () => {
    const lua = 'return {\n    ["percent_finished"] = 0.5,\n}\n';
    expect(parseSidecar(lua)).toEqual({
      percentFinished: 0.5, lastRead: null, title: null, authors: null, language: null,
    });
  });

  it('accepts files without a trailing newline or commas', () => {
    expect(parseSidecar('return {\n["percent_finished"] = 1\n}')).toMatchObject({ percentFinished: 1 });
  });

  it('returns null when percent_finished is absent or unparsable', () => {
    expect(parseSidecar('not lua at all')).toBeNull();
    expect(parseSidecar('return {\n    ["summary"] = { ["status"] = "reading" }\n}')).toBeNull();
    expect(parseSidecar('')).toBeNull();
  });
});

describe('serializeSidecar', () => {
  it('emits the KOReader metadata shape', () => {
    const lua = serializeSidecar({
      percentFinished: 0.4231, lastRead: 1699999999,
      title: 'Titre', authors: 'Auteur', language: 'fr',
    });
    expect(lua).toBe(
      'return {\n'
      + '    ["doc_props"] = {\n'
      + '        ["title"] = "Titre",\n'
      + '        ["authors"] = "Auteur",\n'
      + '        ["language"] = "fr"\n'
      + '    },\n'
      + '    ["percent_finished"] = 0.4231,\n'
      + '    ["last_read"] = 1699999999\n'
      + '}\n',
    );
  });

  it('escapes backslashes and quotes; null doc fields are omitted', () => {
    const lua = serializeSidecar({
      percentFinished: 1, lastRead: null, title: 'a"b\\c', authors: null, language: null,
    });
    expect(lua).toContain('["title"] = "a\\"b\\\\c"');
    expect(lua).not.toContain('authors');
    expect(lua).not.toContain('language');
  });

  it('round-trips through the parser', () => {
    const p = { percentFinished: 0.77, lastRead: 1700000000, title: 'Un "titre"', authors: 'Dupont', language: 'fr' };
    expect(parseSidecar(serializeSidecar(p))).toEqual(p);
  });
});
