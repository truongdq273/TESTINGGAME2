(function () {
      function escapeHTML(str) {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      const inputUrl = document.getElementById('source-url-input');
      const btnLoad = document.getElementById('btn-load-test');
      const btnSave = document.getElementById('btn-save-config');
      const previewCard = document.getElementById('preview-card');
      const previewMeta = document.getElementById('preview-meta');
      const previewList = document.getElementById('preview-questions-list');

      // Load saved
      const saved = localStorage.getItem('frog_game_source_url');
      if (saved) inputUrl.value = saved;

      btnSave.addEventListener('click', () => {
        localStorage.setItem('frog_game_source_url', inputUrl.value.trim());
        alert('Đã lưu cấu hình URL nguồn thành công!');
      });

      btnLoad.addEventListener('click', async () => {
        const url = inputUrl.value.trim();
        btnLoad.disabled = true;
        btnLoad.textContent = 'Đang tải...';

        try {
          const bank = await ClassroomContentLoader.loadQuestionBank(url);
          previewCard.style.display = 'block';
          previewMeta.innerHTML = `
            <div><strong>Tiêu đề:</strong> ${escapeHTML(bank.title)}</div>
            <div><strong>Content Version:</strong> ${escapeHTML(bank.contentVersion)}</div>
            <div><strong>Thời gian tải:</strong> ${escapeHTML(bank.fetchedAt)}</div>
            <div><strong>Số câu hợp lệ:</strong> ${bank.questions.length} câu</div>
          `;

          previewList.innerHTML = '';
          bank.questions.forEach((q, idx) => {
            const div = document.createElement('div');
            div.style.cssText = 'border-bottom:1px solid #e1ece6; padding:10px 0;';
            div.innerHTML = `
              <div style="font-weight:700; color:var(--primary-dark);">Câu ${idx + 1}: ${escapeHTML(q.prompt)}</div>
              <ul style="margin:6px 0 6px 20px; font-size:0.95rem;">
                ${q.options.map(opt => `<li style="${opt.id === q.correctOptionId ? 'color:#28a745; font-weight:700;' : ''}">${escapeHTML(opt.id.toUpperCase())}) ${escapeHTML(opt.text)} ${opt.id === q.correctOptionId ? ' ✓ (Đáp án đúng)' : ''}</li>`).join('')}
              </ul>
              ${q.explanation ? `<div style="font-size:0.85rem; color:#666;">Giải thích: ${escapeHTML(q.explanation)}</div>` : ''}
            `;
            previewList.appendChild(div);
          });
        } catch (err) {
          alert('Lỗi: ' + err.message);
        } finally {
          btnLoad.disabled = false;
          btnLoad.textContent = '🔍 Kiểm Tra & Tải Thử';
        }
      });
    })();
