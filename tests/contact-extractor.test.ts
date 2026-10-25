import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractContactEmails } from '../server/services/contactExtractor';

for (const token of [
  'équipe@atelier.fr', 'e\u0301quipe@atelier.fr', 'contacté@atelier.fr',
  'contact@atélier.fr', 'contact@atelier.fré', 'contact@atelier.fr\u0301',
  'contact@atelier.fr-invalide', 'contact@atelier.fr-', 'contact@atelier.fr_suffix',
  'écontact@atelier.fr-invalide', 'contact@atelier.fr。invalide',
  'Kontact@atelier.fr', 'contact@atelier.frK',
]) {
  test(`rejects the entire unsupported token ${token} in text, mailto and obfuscation`, () => {
    for (const html of [
      `<p>${token}</p>`,
      `<a href="mailto:${encodeURIComponent(token)}">Email</a>`,
      `<a href="mailto:${encodeURIComponent(token)}">${token}</a>`,
      `<p>${token.replace('@', ' [at] ').replaceAll('.', ' [dot] ')}</p>`,
    ]) assert.deepEqual(extractContactEmails(html), [], html);
  });
}

test('keeps addresses surrounded by natural sentence punctuation and parentheses', () => {
  assert.deepEqual(
    extractContactEmails('<p>Écrivez (contact@atelier.fr), puis hello@atelier.fr. Ou : info@atelier.fr! Enfin « owner@atelier.fr ».</p>'),
    ['contact@atelier.fr', 'hello@atelier.fr', 'info@atelier.fr', 'owner@atelier.fr'],
  );
});

test('separates an adjacent inline Email label from the actual address', () => {
  assert.deepEqual(
    extractContactEmails('<span>Email</span><span>info.segment.c@gmail.com</span>'),
    ['info.segment.c@gmail.com'],
  );
});

for (const tag of ['span', 'strong', 'label', 'b', 'em', 'small']) {
  test(`preserves boundaries before and after ${tag} labels`, () => {
    assert.deepEqual(
      extractContactEmails(`<${tag}>Email</${tag}><${tag}>info.segment.c@gmail.com</${tag}><${tag}>Contact</${tag}>`),
      ['info.segment.c@gmail.com'],
    );
  });
}

test('does not strip a real emailinfo local part from contiguous text or mailto', () => {
  assert.deepEqual(
    extractContactEmails('<span>emailinfo.segment.c@gmail.com</span><a href="mailto:emailinfo.other@gmail.com">Email</a>'),
    ['emailinfo.other@gmail.com', 'emailinfo.segment.c@gmail.com'],
  );
});

test('keeps actual mailto evidence first and deduplicates the adjacent visible address', () => {
  assert.deepEqual(
    extractContactEmails('<p>other@atelier.fr</p><label>Email</label><a href="mailto:info.segment.c%40gmail.com?subject=Contact"><strong>info.segment.c@gmail.com</strong></a>'),
    ['info.segment.c@gmail.com', 'other@atelier.fr'],
  );
});

test('joins only explicit obfuscation across inline boundaries and excludes script text', () => {
  assert.deepEqual(
    extractContactEmails('<label>Email</label><span>info.segment.c</span><strong>[at]</strong><span>gmail</span><em>[dot]</em><span>com</span><script>"script@gmail.com"</script><noscript>hidden@gmail.com</noscript><template>template@gmail.com</template>'),
    ['info.segment.c@gmail.com'],
  );
});

test('extracts unique explicit public emails from mailto, HTML footer and explicit obfuscation only', () => {
  const result = extractContactEmails(`<body><a href="MAILTO:Hello%2Bshop%40atelier.fr?subject=test">Mail</a>
  <footer>hello+shop@atelier.fr contact&#64;atelier.fr owner [at] atelier [dot] fr</footer>
  <script>const x='script@atelier.fr'</script><style>.a{content:'css@atelier.fr'}</style>
  <p>fake@example.com x@image.png logo@2x.webp x@bundle.js bad@invalid name at atelier dot fr</p></body>`);
  assert.deepEqual(result, ['hello+shop@atelier.fr', 'contact@atelier.fr', 'owner@atelier.fr']);
});
