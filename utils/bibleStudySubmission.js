const trimString = (value) => String(value || "").trim();

const buildStudyShareBody = ({ reflection = "", answers = [], questions = [] }) => {
  const blocks = [];

  const cleanReflection = trimString(reflection);
  if (cleanReflection) {
    blocks.push(`Reflection\n${cleanReflection}`);
  }

  (questions || []).forEach((question, index) => {
    const cleanQuestion = trimString(question);
    const cleanAnswer = trimString(answers[index]);
    if (!cleanQuestion || !cleanAnswer) return;
    blocks.push(`Q${index + 1}. ${cleanQuestion}\n${cleanAnswer}`);
  });

  return blocks.join("\n\n");
};

const normalizeStudySubmissionAnswers = (answers = [], questionCount = 0) => {
  return Array.from({ length: questionCount }, (_, index) => trimString(answers[index]));
};

const sanitizePagination = ({ page = 1, limit = 10, maxLimit = 50 } = {}) => {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, Math.min(maxLimit, Number.parseInt(limit, 10) || 10));
  return { page: safePage, limit: safeLimit };
};

module.exports = {
  buildStudyShareBody,
  normalizeStudySubmissionAnswers,
  sanitizePagination,
  trimString,
};
