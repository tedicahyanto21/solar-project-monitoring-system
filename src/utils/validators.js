export const emailPattern = {
  value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  message: 'Enter a valid email address',
};

export const required = (label) => ({ value: true, message: `${label} is required` });
