# Spec: Add MIT LICENSE file (issue #1)

## Request
Add a standard MIT LICENSE file to the repo root.

Acceptance criteria:
- File named LICENSE at repo root
- Standard MIT license text
- Copyright line: Copyright (c) 2026 Matthew Wagner
- No other files changed

(End-to-end test of the background agent loop on this repo.)

## Approved plan

🤖 **Proposed plan** (local model):


1. Create `LICENSE` (repo root) with the standard MIT license text, substituting the year and copyright holder:

```
MIT License

Copyright (c) 2026 Matthew Wagner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

2. No other files modified — this is a single new-file addition.
3. Commit as a single commit (e.g. `chore: add MIT LICENSE`).

_Apply `agent:approved` to have me implement this, or refine the issue and re-apply `agent:ready`._
