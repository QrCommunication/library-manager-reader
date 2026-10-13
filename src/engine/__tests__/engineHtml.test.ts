import { buildEngineHtml } from '../engineHtml';

describe('buildEngineHtml', () => {
  it('gives the document and #book a full-viewport height so the foliate view is not collapsed', () => {
    const html = buildEngineHtml();
    expect(html).toMatch(/html\s*,\s*body\s*\{[^}]*height\s*:\s*100%/);
    expect(html).toMatch(/#book\s*\{[^}]*height\s*:\s*100%/);
    expect(html).toMatch(/body\s*\{[^}]*margin\s*:\s*0/);
  });

  it('keeps #book box-sizing border-box so theme padding does not overflow the viewport', () => {
    const html = buildEngineHtml();
    expect(html).toMatch(/#book\s*\{[^}]*box-sizing\s*:\s*border-box/);
  });
});
