/**
 * wicked-crew#1950: how many times crew has ANSWERED this page over HTTP. A page's own slow reads can queue its
 * `/health` read past studio's 10 s bound (the browser holds a few sockets per origin over HTTP/1.1) while crew
 * answers in milliseconds; an answer to any other read meanwhile is the evidence that crew is up and only slow.
 *
 * A count, not a clock: "an answer since this read began" is then exact, whatever the clock does. Only a 2xx counts:
 * a proxy in front of crew can answer 401, 403 or a gateway 5xx while crew is down, and a 304 is a cache's answer, not
 * crew's. Evidence only: no answer or data is ever served from it.
 */
let answers = 0;

/** `apiFetch` calls this with every HTTP status it receives from crew. */
export function noteCrewAnswer(status: number): void {
  if (status >= 200 && status < 300) answers += 1;
}

/** The count now: a read keeps it at its start and compares with {@link crewAnsweredSince}. */
export function crewAnswerCount(): number {
  return answers;
}

/** Whether crew answered some read after the count was `mark`. */
export function crewAnsweredSince(mark: number): boolean {
  return answers > mark;
}

/** Tests: forget every answer. */
export function resetCrewHeard(): void {
  answers = 0;
}
