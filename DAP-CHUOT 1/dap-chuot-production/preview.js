import {unlock,sfx,toggleMute,isMuted} from './audio.js';
const $=s=>document.querySelector(s);let ready=false;
function reset(){ready=false;$('#mouse').className='mouse-target';$('#mouse').disabled=true;$('#mallet').className='mallet';$('#callout').textContent='Mình đang đợi bạn!';$('#feedback').textContent='Chọn một hiệu ứng phía trên để thử.'}
$('#try-correct').onclick=()=>{unlock();reset();ready=true;sfx('correct');$('#mouse').disabled=false;$('#mouse').classList.add('ready');$('#callout').textContent='Bấm vào chuột!';$('#feedback').textContent='Chính xác! +10 điểm. Bây giờ bạn có thể đập chuột.'};
$('#try-wrong').onclick=()=>{unlock();reset();sfx('miss');$('#mouse').classList.add('away');$('#callout').textContent='Chuột trốn mất rồi!';$('#feedback').textContent='Chưa đúng, +0 điểm. Thử lại ở lượt tiếp theo nhé.'};
$('#mouse').onclick=()=>{if(!ready)return;ready=false;unlock();sfx('hit');$('#mouse').className='mouse-target hit';$('#mouse').disabled=true;$('#mallet').classList.add('swing');$('#callout').textContent='Đập trúng rồi!';$('#feedback').textContent='Bốp! Bạn đã bắt được chú chuột tinh nghịch.'};
$('#reset').onclick=()=>{unlock();reset();sfx('pop')};$('#mute').textContent=isMuted()?'Âm thanh: tắt':'Âm thanh: bật';$('#mute').onclick=()=>{unlock();toggleMute();$('#mute').textContent=isMuted()?'Âm thanh: tắt':'Âm thanh: bật'};
