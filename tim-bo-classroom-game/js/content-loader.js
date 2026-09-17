/**
 * Content Loader for "Tìm Bò - Let's Save the Cows!"
 * Conforms to external-content.md specification (Schema v1, Content Hash Versioning, Sanitization)
 */
(function (global) {
  'use strict';

  function simpleHash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return 'v-' + Math.abs(hash).toString(16).padStart(8, '0');
  }

  function validateBank(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Dữ liệu ngân hàng câu hỏi không hợp lệ (không phải object).');
    }
    if (data.schemaVersion !== 1) {
      throw new Error(`Phiên bản schema ${data.schemaVersion} không được hỗ trợ (cần phiên bản 1).`);
    }
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('Danh sách câu hỏi trống hoặc không phải mảng.');
    }

    const qIds = new Set();
    const validatedQuestions = [];

    data.questions.forEach((q, idx) => {
      const qNum = idx + 1;
      if (!q || typeof q !== 'object') {
        throw new Error(`Câu hỏi #${qNum} không hợp lệ.`);
      }
      if (!q.id || typeof q.id !== 'string') {
        throw new Error(`Câu hỏi #${qNum} thiếu trường 'id'.`);
      }
      if (qIds.has(q.id)) {
        throw new Error(`Trùng lặp ID câu hỏi '${q.id}' tại câu #${qNum}.`);
      }
      qIds.add(q.id);

      if (!q.prompt || typeof q.prompt !== 'string' || !q.prompt.trim()) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có nội dung câu hỏi rỗng.`);
      }

      if (q.type && q.type !== 'single-choice') {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có dạng '${q.type}' chưa hỗ trợ.`);
      }

      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) phải có ít nhất 2 lựa chọn.`);
      }

      const optIds = new Set();
      const validatedOptions = [];
      q.options.forEach((opt, optIdx) => {
        if (!opt || typeof opt !== 'object' || !opt.id || typeof opt.text !== 'string') {
          throw new Error(`Lựa chọn #${optIdx + 1} của câu #${qNum} không hợp lệ.`);
        }
        if (optIds.has(opt.id)) {
          throw new Error(`Trùng lặp id lựa chọn '${opt.id}' tại câu #${qNum}.`);
        }
        optIds.add(opt.id);
        validatedOptions.push({
          id: String(opt.id).trim(),
          text: String(opt.text).trim()
        });
      });

      if (!q.correctOptionId || !optIds.has(q.correctOptionId)) {
        throw new Error(`Câu hỏi #${qNum} (${q.id}) có correctOptionId '${q.correctOptionId}' không khớp với bất kỳ lựa chọn nào.`);
      }

      const points = Number.isFinite(q.points) && q.points >= 0 ? q.points : 10;

      validatedQuestions.push({
        id: String(q.id).trim().slice(0, 36),
        type: 'single-choice',
        prompt: String(q.prompt).trim().slice(0, 500),
        options: validatedOptions,
        correctOptionId: String(q.correctOptionId).trim().slice(0, 10),
        points: points
      });
    });

    // Giới hạn tối đa 100 câu hỏi (theo chuẩn phòng chống DoS bộ nhớ)
    const finalQuestions = validatedQuestions.slice(0, 100);

    // Content version hash based on canonical string representation
    const canonicalStr = JSON.stringify(finalQuestions);
    const contentVersion = simpleHash(canonicalStr);

    return {
      schemaVersion: 1,
      bankId: String(data.bankId || 'bank-' + contentVersion).slice(0, 64),
      title: String(data.title || 'Tìm Bò - Let\'s Save the Cows').slice(0, 120),
      description: String(data.description || '').slice(0, 300),
      contentVersion: contentVersion,
      fetchedAt: new Date().toISOString(),
      questions: finalQuestions
    };
  }

  /**
   * Tạo bản copy câu hỏi cho học sinh (LOẠI BỎ correctOptionId)
   */
  function createLearnerPayload(questions) {
    return questions.map(q => ({
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options.map(opt => ({ id: opt.id, text: opt.text })),
      points: q.points
    }));
  }

  /**
   * Tải ngân hàng câu hỏi an toàn (Kiểm tra HTTPS, Whitelist host, Timeout 10s, Max 1MB)
   * @param {Object} sourceConfig { type: 'local'|'url'|'json', url?: string, rawJson?: string }
   * @param {Object} options { signal?: AbortSignal }
   */
  async function loadQuestionBank(sourceConfig = { type: 'local' }, options = {}) {
    let rawData = null;

    if (sourceConfig.type === 'json' && sourceConfig.rawJson) {
      if (sourceConfig.rawJson.length > 1024 * 1024) {
        throw new Error('Dữ liệu JSON thô vượt quá giới hạn 1MB cho phép.');
      }
      rawData = JSON.parse(sourceConfig.rawJson);
    } else if (sourceConfig.type === 'url' && sourceConfig.url) {
      const urlStr = sourceConfig.url.trim();

      // Kiểm tra URL bảo mật
      let parsedUrl;
      try {
        parsedUrl = new URL(urlStr, window.location.href);
      } catch {
        throw new Error('Định dạng URL nguồn câu hỏi không hợp lệ.');
      }

      // Nguồn ngoài bắt buộc sử dụng HTTPS
      if (parsedUrl.origin !== window.location.origin) {
        if (parsedUrl.protocol !== 'https:') {
          throw new Error('Nguồn câu hỏi ngoài bắt buộc sử dụng giao thức HTTPS bảo mật.');
        }

        // Whitelist các máy chủ tin cậy được phép tải
        const safeDomains = [
          'edupia.vn',
          'static-mass.edupia.vn',
          'docs.google.com',
          'drive.google.com',
          'script.google.com',
          'localhost',
          '127.0.0.1'
        ];
        const hostname = parsedUrl.hostname.toLowerCase();
        const isSafe = safeDomains.some(d => hostname === d || hostname.endsWith('.' + d));
        if (!isSafe) {
          throw new Error(`Máy chủ '${hostname}' chưa nằm trong danh sách nguồn tin cậy của hệ thống.`);
        }
      }

      // Thiết lập Timeout 10 giây
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const activeSignal = options.signal || controller.signal;

      try {
        const resp = await fetch(parsedUrl.href, {
          signal: activeSignal,
          headers: { 'Accept': 'application/json' },
          cache: 'no-cache'
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
          throw new Error(`Không thể tải câu hỏi từ URL (HTTP ${resp.status}: ${resp.statusText})`);
        }

        // Giới hạn phản hồi tối đa 1MB
        const cl = resp.headers.get('content-length');
        if (cl && parseInt(cl, 10) > 1024 * 1024) {
          throw new Error('Dung lượng tệp câu hỏi vượt quá giới hạn 1MB.');
        }

        const text = await resp.text();
        if (text.length > 1024 * 1024) {
          throw new Error('Dung lượng tệp câu hỏi vượt quá giới hạn 1MB.');
        }

        rawData = JSON.parse(text);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Quá thời gian chờ tải câu hỏi từ máy chủ (Timeout 10 giây).');
        }
        throw err;
      }
    } else {
      // Mặc định: local fallback content.json
      const resp = await fetch('content.json', {
        signal: options.signal,
        cache: 'no-cache'
      });
      if (!resp.ok) {
        throw new Error(`Không thể tải content.json (HTTP ${resp.status})`);
      }
      rawData = await resp.json();
    }

    return validateBank(rawData);
  }

  // Quản lý cấu hình nguồn câu hỏi lưu ở LocalStorage
  const SOURCE_KEY = 'TIM_BO_CONTENT_SOURCE';
  function getSavedSourceConfig() {
    try {
      const s = localStorage.getItem(SOURCE_KEY);
      return s ? JSON.parse(s) : { type: 'local' };
    } catch {
      return { type: 'local' };
    }
  }

  function saveSourceConfig(cfg) {
    localStorage.setItem(SOURCE_KEY, JSON.stringify(cfg));
  }

  global.ContentLoader = Object.freeze({
    loadQuestionBank,
    createLearnerPayload,
    validateBank,
    getSavedSourceConfig,
    saveSourceConfig
  });
})(typeof window !== 'undefined' ? window : this);
