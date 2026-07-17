import assert from 'node:assert/strict'
import { __quizGeneratorTest } from '../lib/quiz-generator'

const questions = __quizGeneratorTest.parseGeneratedQuestions(JSON.stringify({
  questions: [
    {
      prompt: 'Which retrieval step happens first?',
      answer: 'Embed the query',
      type: 'mcq',
      options: ['Search the graph', 'Embed the query', 'Write the final answer'],
    },
    {
      prompt: 'What is the main benefit?',
      answer: 'Grounded answers',
      type: 'short',
    },
  ],
}))

assert.equal(questions.length, 2)
assert.equal(questions[0].type, 'mcq')
assert.deepEqual(questions[0].options, ['Search the graph', 'Embed the query', 'Write the final answer'])
assert.equal(questions[1].type, 'short')

const repaired = __quizGeneratorTest.parseGeneratedQuestions(JSON.stringify({
  questions: [{ prompt: 'Pick one', answer: 'Correct', type: 'mcq', options: ['Wrong'] }],
}))
assert.deepEqual(repaired[0].options, ['Correct', 'Wrong'])

console.log('quiz mcq checks passed')
