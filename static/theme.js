// Apply the device preference before paint. This file contains no user data.
try {
	const theme = localStorage.getItem('herbarium-theme');
	if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
	// System preference still works when browser storage is unavailable.
}
