import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MIN_WORDS, detectLanguage, primarySubtag, tokens } from '../src/domain/language';

const SPANISH =
  'Esta guía explica los beneficios disponibles para los veteranos y sus familias. Para solicitar los servicios, complete el formulario en línea o visite una oficina regional. Si tiene preguntas sobre su elegibilidad, comuníquese con nosotros por teléfono.';
const FRENCH =
  'Ce guide explique les prestations offertes aux anciens combattants et à leurs familles. Pour demander les services, remplissez le formulaire en ligne ou rendez-vous dans un bureau régional. Si vous avez des questions sur votre admissibilité, contactez-nous.';
const ENGLISH =
  'This guide explains the benefits available to veterans and their families. To apply for services, complete the form online or visit a regional office. If you have questions about your eligibility, contact us by phone.';

test('a Spanish or French passage is detected, with the tag Word writes for it', () => {
  assert.deepEqual(detectLanguage(SPANISH), { language: 'es', tag: 'es-US', slot: 'val', name: 'Spanish' });
  assert.deepEqual(detectLanguage(FRENCH), { language: 'fr', tag: 'fr-FR', slot: 'val', name: 'French' });
});

test('an English passage in an English document is null; in a Spanish document it is English', () => {
  assert.equal(detectLanguage(ENGLISH), null);
  assert.deepEqual(detectLanguage(ENGLISH, 'es'), { language: 'en', tag: 'en-US', slot: 'val', name: 'English' });
  assert.equal(detectLanguage(SPANISH, 'es'), null);
});

test('proper names and borrowed phrases do not flag an English paragraph', () => {
  // 3.1.2 exempts names and words that are part of the surrounding language.
  // A wrong flag costs a reviewer's time on every document, so these must
  // stay quiet.
  const names =
    'The report was prepared by José García de la Cruz and María del Carmen Ortega for the Department of Veterans Affairs, with input from the Los Angeles and San Antonio regional offices and the El Paso field team.';
  const borrowed =
    'The de facto standard for this ad hoc process is a status quo that persists per se, and the committee reviewed it vis-à-vis the prior memorandum before issuing the final report to the agency.';
  assert.equal(detectLanguage(names), null);
  assert.equal(detectLanguage(borrowed), null);
});

test('a passage under twenty words is never flagged, whatever it is', () => {
  assert.equal(detectLanguage('Gracias por su ayuda con la solicitud.'), null);
  assert.equal(tokens('Gracias por su ayuda con la solicitud.').length < MIN_WORDS, true);
});

test('non-Latin scripts are decided by script, into the attribute Word expects', () => {
  assert.deepEqual(detectLanguage('本指南介绍了退伍军人及其家属可以获得的福利。请在线填写表格。'), {
    language: 'zh',
    tag: 'zh-CN',
    slot: 'eastAsia',
    name: 'Chinese',
  });
  assert.equal(detectLanguage('このガイドは退役軍人とその家族が利用できる給付について説明します。')?.language, 'ja');
  assert.equal(detectLanguage('이 안내서는 참전 용사와 그 가족이 받을 수 있는 혜택을 설명합니다.')?.language, 'ko');
  assert.equal(detectLanguage('Это руководство объясняет льготы, доступные ветеранам и их семьям.')?.language, 'ru');
  assert.deepEqual(detectLanguage('يشرح هذا الدليل المزايا المتاحة للمحاربين القدامى وأسرهم.')?.slot, 'bidi');
  assert.equal(detectLanguage('Section 3.1: see 中文 for the term.'), null, 'a few characters in another script are a term, not a passage');
});

test('tokens ignore numbers and punctuation but keep accents', () => {
  assert.deepEqual(tokens('El 30 de junio, ¡gracias! (véase §4)'), ['el', 'de', 'junio', 'gracias', 'véase']);
  assert.equal(primarySubtag('zh-Hans-CN'), 'zh');
  assert.equal(primarySubtag('EN_us'), 'en');
});
