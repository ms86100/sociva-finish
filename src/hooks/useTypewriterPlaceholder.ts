// @ts-nocheck
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Typewriter placeholder hook.
 * Cycles through a list of words, typing them letter-by-letter
 * and then erasing before moving to the next word.
 *
 * @param words  - array of words/phrases to cycle through
 * @param prefix - static prefix (e.g. 'Search "')
 * @param suffix - static suffix (e.g. '"')
 * @param typeSpeed   - ms per character while typing
 * @param eraseSpeed  - ms per character while erasing
 * @param pauseAfterType - ms to hold after fully typed
 * @param pauseAfterErase - ms to hold after fully erased
 */
export function useTypewriterPlaceholder(
  words: string[],
  {
    prefix = 'Search "',
    suffix = '"',
    typeSpeed = 80,
    eraseSpeed = 40,
    pauseAfterType = 1800,
    pauseAfterErase = 300,
  }: {
    prefix?: string;
    suffix?: string;
    typeSpeed?: number;
    eraseSpeed?: number;
    pauseAfterType?: number;
    pauseAfterErase?: number;
  } = {},
): string {
  const [displayed, setDisplayed] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const safeWords = words.length > 0 ? words : ['products'];

  const tick = useCallback(() => {
    const currentWord = safeWords[wordIndex % safeWords.length];

    if (isTyping) {
      if (displayed.length < currentWord.length) {
        // Type next character
        timerRef.current = setTimeout(() => {
          setDisplayed(currentWord.slice(0, displayed.length + 1));
        }, typeSpeed);
      } else {
        // Fully typed → pause then start erasing
        timerRef.current = setTimeout(() => {
          setIsTyping(false);
        }, pauseAfterType);
      }
    } else {
      if (displayed.length > 0) {
        // Erase one character
        timerRef.current = setTimeout(() => {
          setDisplayed(displayed.slice(0, -1));
        }, eraseSpeed);
      } else {
        // Fully erased → pause then move to next word
        timerRef.current = setTimeout(() => {
          setWordIndex((prev) => (prev + 1) % safeWords.length);
          setIsTyping(true);
        }, pauseAfterErase);
      }
    }
  }, [displayed, wordIndex, isTyping, safeWords, typeSpeed, eraseSpeed, pauseAfterType, pauseAfterErase]);

  useEffect(() => {
    tick();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tick]);

  // Reset when words list changes
  useEffect(() => {
    setDisplayed('');
    setWordIndex(0);
    setIsTyping(true);
  }, [words.length]);

  return `${prefix}${displayed}${suffix}`;
}
