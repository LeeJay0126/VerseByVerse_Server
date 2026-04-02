const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildStudyShareBody,
  normalizeStudySubmissionAnswers,
  sanitizePagination,
} = require("../utils/bibleStudySubmission");

test("buildStudyShareBody builds reflection and answered questions only", () => {
  const body = buildStudyShareBody({
    reflection: "I need to trust more.",
    answers: ["Because God provides.", "", "I can pray first."],
    questions: ["What stands out?", "Where do you struggle?", "How will you apply this?"],
  });

  assert.equal(
    body,
    [
      "Reflection",
      "I need to trust more.",
      "",
      "Q1. What stands out?",
      "Because God provides.",
      "",
      "Q3. How will you apply this?",
      "I can pray first.",
    ].join("\n")
  );
});

test("normalizeStudySubmissionAnswers matches question count", () => {
  const answers = normalizeStudySubmissionAnswers([" one ", "two", "three"], 2);
  assert.deepEqual(answers, ["one", "two"]);
});

test("sanitizePagination clamps values", () => {
  assert.deepEqual(sanitizePagination({ page: "-2", limit: "99", maxLimit: 20 }), {
    page: 1,
    limit: 20,
  });
});
