/**
 * Classroom Game Content Loader
 * Manages loading, validation, and version hashing for question banks.
 */
(function (global) {
  'use strict';

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return 'cv-' + Math.abs(hash).toString(36);
  }

  function validateBank(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Dữ liệu bộ câu hỏi phải là một object JSON');
    }
    if (data.schemaVersion !== 1) {
      throw new Error('Chỉ hỗ trợ schemaVersion = 1');
    }
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Danh sách câu hỏi (questions) không được để trống');
    }
    if (data.questions.length > 100) {
      throw new Error('Chỉ hỗ trợ tối đa 100 câu hỏi');
    }

    const seenIds = new Set();
    const validatedQuestions = data.questions.map((q, idx) => {
      if (!q || typeof q !== 'object') {
        throw new Error(`Câu hỏi tại vị trí ${idx + 1} không hợp lệ`);
      }
      const id = String(q.id || `q-${idx + 1}`).trim();
      if (!id || seenIds.has(id)) {
        throw new Error(`ID câu hỏi "${id}" bị trùng lặp hoặc không hợp lệ`);
      }
      seenIds.add(id);

      const prompt = String(q.prompt || '').trim();
      if (!prompt) {
        throw new Error(`Câu hỏi "${id}" thiếu nội dung câu hỏi (prompt)`);
      }
      if (prompt.length > 1000) {
        throw new Error(`Câu hỏi "${id}" có nội dung quá dài (tối đa 1000 ký tự)`);
      }

      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Câu hỏi "${id}" phải có ít nhất 2 lựa chọn (options)`);
      }
      if (q.options.length > 10) {
        throw new Error(`Câu hỏi "${id}" có quá nhiều lựa chọn (tối đa 10)`);
      }

      const seenOptIds = new Set();
      const options = q.options.map((opt, oIdx) => {
        const oId = String(opt.id || String.fromCharCode(97 + oIdx)).trim().toLowerCase();
        if (!oId || seenOptIds.has(oId)) {
          throw new Error(`Lựa chọn tại câu "${id}" có ID trùng lặp: ${oId}`);
        }
        seenOptIds.add(oId);
        const text = String(opt.text || '').trim();
        if (!text) {
          throw new Error(`Lựa chọn "${oId}" tại câu "${id}" không có nội dung chữ`);
        }
        if (text.length > 300) {
          throw new Error(`Lựa chọn "${oId}" tại câu "${id}" có nội dung quá dài (tối đa 300 ký tự)`);
        }
        return { id: oId, text };
      });

      const correctOptionId = String(q.correctOptionId || '').trim().toLowerCase();
      if (!seenOptIds.has(correctOptionId)) {
        throw new Error(`Câu hỏi "${id}" có đáp án đúng "${correctOptionId}" không khớp với danh sách lựa chọn`);
      }

      const points = Number.isFinite(q.points) && q.points >= 0 ? q.points : 10;
      const explanation = q.explanation ? String(q.explanation).trim() : '';

      return {
        id,
        type: 'single-choice',
        prompt,
        options,
        correctOptionId,
        explanation,
        points
      };
    });

    const normalizedString = JSON.stringify(validatedQuestions);
    const contentVersion = simpleHash(normalizedString);

    return {
      schemaVersion: 1,
      title: data.title || 'Bộ câu hỏi',
      topic: data.topic || '',
      contentVersion,
      fetchedAt: new Date().toISOString(),
      questions: validatedQuestions
    };
  }

  function parseGoogleDocText(rawText) {
    // Parse Google Docs exported plain text
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const questions = [];
    let currentQ = null;
    let mode = 'questions';
    const answerMap = {};
    const explanationMap = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.toLowerCase().includes('answer key & explanations')) {
        mode = 'answers';
        continue;
      }

      if (mode === 'questions') {
        const qMatch = line.match(/^Question\s+(\d+)/i);
        if (qMatch) {
          if (currentQ) questions.push(currentQ);
          currentQ = {
            num: parseInt(qMatch[1], 10),
            id: `q-${qMatch[1]}`,
            type: 'single-choice',
            prompt: '',
            options: [],
            points: 10
          };
          continue;
        }

        if (currentQ) {
          const optMatch = line.match(/^[*\-]?\s*([A-D])\)\s*(.*)$/i);
          if (optMatch) {
            currentQ.options.push({
              id: optMatch[1].toLowerCase(),
              text: optMatch[2].trim()
            });
          } else if (currentQ.options.length === 0) {
            currentQ.prompt = currentQ.prompt ? currentQ.prompt + ' ' + line : line;
          }
        }
      } else {
        // Mode = answers: format could be "1 \t B) Lion \t Explanation" or consecutive lines
        const ansMatch = line.match(/^(\d+)\s+([A-D])\)?\s*(?:[A-Za-z0-9\s]*)\s*(.*)$/i);
        if (ansMatch) {
          const num = parseInt(ansMatch[1], 10);
          answerMap[num] = ansMatch[2].toLowerCase();
          if (ansMatch[3]) explanationMap[num] = ansMatch[3].trim();
        } else {
          // Check line matching single digit followed by letter on next line
          const numMatch = line.match(/^(\d+)$/);
          if (numMatch && i + 1 < lines.length) {
            const next = lines[i + 1];
            const letterMatch = next.match(/^([A-D])\)?\s*(.*)$/i);
            if (letterMatch) {
              const num = parseInt(numMatch[1], 10);
              answerMap[num] = letterMatch[1].toLowerCase();
              if (i + 2 < lines.length && !lines[i + 2].match(/^\d+$/)) {
                explanationMap[num] = lines[i + 2].trim();
              }
            }
          }
        }
      }
    }

    if (currentQ) questions.push(currentQ);

    questions.forEach(q => {
      q.correctOptionId = answerMap[q.num] || (q.options[0] ? q.options[0].id : 'a');
      q.explanation = explanationMap[q.num] || '';
      delete q.num;
    });

    return {
      schemaVersion: 1,
      title: 'English Practice Exercise: The Animal Kingdom',
      questions
    };
  }

  async function loadQuestionBank(sourceConfig, { signal: externalSignal } = {}) {
    const config = typeof sourceConfig === 'string' ? { url: sourceConfig } : (sourceConfig || {});
    let rawUrl = config.url || './content.json';

    if (rawUrl !== './content.json') {
      try {
        const u = new URL(rawUrl);
        if (u.protocol !== 'https:') throw new Error('Phải dùng HTTPS');
        const allowedHosts = ['docs.google.com', 'raw.githubusercontent.com', 'script.google.com'];
        if (!allowedHosts.includes(u.host)) throw new Error('Host không được hỗ trợ');
      } catch (e) {
        throw new Error(`URL không hợp lệ hoặc không an toàn: ${e.message}`);
      }
    }

    // Convert Google Docs sharing URL to export URL if needed
    if (rawUrl.includes('docs.google.com/document/d/')) {
      const docIdMatch = rawUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (docIdMatch) {
        rawUrl = `https://docs.google.com/document/d/${docIdMatch[1]}/export?format=txt`;
      }
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000); // 10s timeout
    if (externalSignal) {
      externalSignal.addEventListener('abort', () => abortController.abort());
    }

    let response;
    try {
      response = await fetch(rawUrl, {
        signal: abortController.signal,
        cache: 'no-cache',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      // If fetching remote fails (e.g. CORS on file:// or local), fallback to local content.json
      if (rawUrl !== './content.json') {
        console.warn(`Không thể tải từ ${rawUrl} (${err.message}). Tự động fallback về ./content.json`);
        response = await fetch('./content.json', { signal: externalSignal });
      } else {
        throw err;
      }
    }

    if (!response.ok) {
      if (rawUrl !== './content.json') {
        console.warn(`HTTP ${response.status} từ ${rawUrl}. Fallback về ./content.json`);
        response = await fetch('./content.json', { signal: externalSignal });
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error('Nội dung quá lớn (vượt quá 1MB)');
    
    let parsedData;
    try {
      parsedData = JSON.parse(text);
    } catch (e) {
      parsedData = parseGoogleDocText(text);
    }

    return validateBank(parsedData);
  }

  function getLearnerSafeQuestions(bank) {
    return bank.questions.map(q => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options.map(opt => ({ id: opt.id, text: opt.text })),
      points: q.points
    }));
  }

  global.ClassroomContentLoader = Object.freeze({
    loadQuestionBank,
    validateBank,
    getLearnerSafeQuestions
  });
})(window);
