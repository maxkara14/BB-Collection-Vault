import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function harness() {
    const context = createContext({ jQuery() {} });
    const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    const module = new SourceTextModule(source + '\nexport { normalizeDisplaySpaces, escapeHtml, escapeDisplayText, getFilteredOrbs, renderOrbCard, renderOrbDetail, renderAchievementItem, uiState };', { context });
    const mocks = {
        '../../../../script.js': { eventSource: {}, event_types: {}, extension_prompt_roles: {}, extension_prompt_types: {}, saveSettingsDebounced() {}, setExtensionPrompt() {} },
        '../../../extensions.js': { extension_settings: {} },
    };
    await module.link(name => new SyntheticModule(Object.keys(mocks[name]), function () {
        for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value);
    }, { context }));
    await module.evaluate();
    return module.namespace;
}

test('all supported space substitutes become spaces without damaging normal Unicode', async () => {
    const api = await harness();
    const codes = [0xA0, 0x1680, ...Array.from({ length: 12 }, (_, i) => 0x2000 + i),
        0x202F, 0x205F, 0x2800, 0x3000, 0xFEFF, 0x115F, 0x1160, 0x3164, 0xFFA0];
    for (const code of codes) assert.equal(api.normalizeDisplaySpaces(`а${String.fromCodePoint(code)}б`), 'а б');
    const text = 'Обычный  текст\r\n\t👩‍💻 ❤️ فارسی\u200Ctext';
    assert.equal(api.normalizeDisplaySpaces(text), text);
    assert.equal(api.normalizeDisplaySpaces('а\u2800\u2800б'), 'а  б');
});

test('existing orb cards and details display clean text without changing stored records or identity', async () => {
    const api = await harness();
    const orb = { hash: 'existing-hash', contentHash: 'existing-content', title: 'Точильный\u2800камень',
        source: 'Сэндзюро\u3164Рэнгоку', fragmentType: 'Важная\u2009деталь', rarity: 'Common',
        text: 'Первая\u00A0строка\nВторая\u2800строка 👩‍💻 <script>"&', createdAt: 1 };
    const before = JSON.stringify(orb);
    const card = api.renderOrbCard(orb);
    const detail = api.renderOrbDetail(orb);
    assert.ok(card.includes('Точильный камень'));
    assert.ok(detail.includes('Сэндзюро Рэнгоку'));
    assert.ok(detail.includes('Первая строка<br>Вторая строка 👩‍💻'));
    assert.ok(detail.includes('&lt;script&gt;&quot;&amp;'));
    assert.ok(card.includes('existing-hash'));
    assert.equal(JSON.stringify(orb), before);
});

test('search matches normal and decorative spaces in both query and stored text', async () => {
    const api = await harness();
    const orbs = [{ title: 'Ночная\u2800тишина', rarity: 'Common' }, { title: 'Другой предмет', rarity: 'Rare' }];
    for (const search of ['ночная тишина', 'ночная\u3164тишина']) {
        api.uiState.search = search;
        assert.equal(api.getFilteredOrbs(orbs)[0], orbs[0]);
        assert.equal(api.getFilteredOrbs(orbs).length, 1);
    }
    api.uiState.rarityFilter = 'Rare';
    assert.equal(api.getFilteredOrbs(orbs).length, 0);
});

test('HTML escaping also cleans achievement and toast text safely', async () => {
    const api = await harness();
    assert.equal(api.escapeDisplayText('Новая\u2800ачивка <img> & "текст"'), 'Новая ачивка &lt;img&gt; &amp; &quot;текст&quot;');
    const item = { id: 'id\u2800original', rarity: 'common', title: 'Новая\u2800ачивка', description: 'Очень\u3164важно' };
    const html = api.renderAchievementItem(item);
    assert.ok(html.includes('Новая ачивка'));
    assert.ok(html.includes('Очень важно'));
    assert.ok(html.includes('data-achievement-id="id\u2800original"'));
});
