(function () {
  const token = new URLSearchParams(location.search).get('token');
  const resetFormBox = document.getElementById('resetFormBox');
  const resetSuccessBox = document.getElementById('resetSuccessBox');
  const resetInvalidBox = document.getElementById('resetInvalidBox');
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const newPassword = document.getElementById('newPassword');
  const resetError = document.getElementById('resetError');

  if (!token) {
    resetFormBox.classList.add('hidden');
    resetInvalidBox.classList.remove('hidden');
    return;
  }

  resetPasswordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    resetError.classList.add('hidden');
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: newPassword.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      resetError.textContent = data.error || 'Could not reset password.';
      resetError.classList.remove('hidden');
      return;
    }
    resetFormBox.classList.add('hidden');
    resetSuccessBox.classList.remove('hidden');
  });
})();
