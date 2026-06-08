/* ── INITIALIZE REFERRAL CODE ── */
function getActiveReferralCode() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  if (REFERRAL_CONFIG.specialDates[dateStr]) {
    return REFERRAL_CONFIG.specialDates[dateStr];
  }

  const dayOfWeek = today.getDay();
  if (REFERRAL_CONFIG.weeklyCodes && REFERRAL_CONFIG.weeklyCodes[dayOfWeek]) {
    return REFERRAL_CONFIG.weeklyCodes[dayOfWeek];
  }

  return REFERRAL_CONFIG.defaultCode;
}

function initReferralCode() {
  const codeBox = document.querySelector('.referral-code-box');
  if (codeBox) {
    const activeCode = getActiveReferralCode();
    codeBox.textContent = activeCode;

    codeBox.title = "Click để sao chép mã giới thiệu";
    codeBox.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(activeCode);
        codeBox.textContent = "ĐÃ CHÉP!";
        codeBox.style.background = "#2ecc71";
        codeBox.style.color = "#ffffff";
        codeBox.style.borderColor = "#2ecc71";

        setTimeout(() => {
          codeBox.textContent = activeCode;
          codeBox.style.background = "#ffffff";
          codeBox.style.color = "var(--orange)";
          codeBox.style.borderColor = "var(--orange-light)";
        }, 1500);
      } catch (err) {
        console.error("Could not copy referral code:", err);
      }
    });
  }
}
