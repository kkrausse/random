package dev.example.kindlecontext;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class SnapshotContinuity {
    private static final int OVERLAP_WORDS = 12;
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*");

    private SnapshotContinuity() {
    }

    static boolean overlaps(String first, String second) {
        String[] firstWords = words(first);
        String[] secondWords = words(second);
        if (firstWords.length < OVERLAP_WORDS || secondWords.length < OVERLAP_WORDS) {
            return false;
        }

        Set<String> phrases = new HashSet<>();
        for (int i = 0; i <= firstWords.length - OVERLAP_WORDS; i++) {
            phrases.add(phrase(firstWords, i));
        }
        for (int i = 0; i <= secondWords.length - OVERLAP_WORDS; i++) {
            if (phrases.contains(phrase(secondWords, i))) {
                return true;
            }
        }
        return false;
    }

    private static String[] words(String text) {
        Matcher matcher = WORD.matcher(text.toLowerCase(Locale.ROOT));
        StringBuilder normalized = new StringBuilder();
        while (matcher.find()) {
            if (normalized.length() > 0) {
                normalized.append('\n');
            }
            normalized.append(matcher.group());
        }
        return normalized.length() == 0 ? new String[0] : normalized.toString().split("\\n");
    }

    private static String phrase(String[] words, int start) {
        StringBuilder phrase = new StringBuilder();
        for (int i = 0; i < OVERLAP_WORDS; i++) {
            if (i > 0) {
                phrase.append('\n');
            }
            phrase.append(words[start + i]);
        }
        return phrase.toString();
    }
}
