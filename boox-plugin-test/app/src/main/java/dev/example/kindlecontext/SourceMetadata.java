package dev.example.kindlecontext;

final class SourceMetadata {
    final String title;
    final String author;

    SourceMetadata(String title, String author) {
        this.title = title;
        this.author = author;
    }

    static SourceMetadata fromKindleDescription(String description) {
        String value = description == null ? "" : description.trim();
        String recentPrefix = "Most recent book. ";
        if (value.startsWith(recentPrefix)) {
            value = value.substring(recentPrefix.length());
        }
        int status = value.indexOf(", , Book");
        if (status < 0) {
            return new SourceMetadata("", "");
        }
        value = value.substring(0, status).trim();

        String[] fields = value.split(", ");
        if (fields.length < 2) {
            return new SourceMetadata(value, "");
        }
        if (fields.length >= 3 && looksLikeInvertedName(
                fields[fields.length - 2], fields[fields.length - 1])) {
            String title = join(fields, fields.length - 2);
            String author = fields[fields.length - 1] + " " + fields[fields.length - 2];
            return new SourceMetadata(title, author);
        }
        return new SourceMetadata(join(fields, fields.length - 1), fields[fields.length - 1]);
    }

    private static boolean looksLikeInvertedName(String lastName, String givenNames) {
        return !lastName.contains(" ") && givenNames.contains(" ")
                && lastName.length() <= 40 && givenNames.length() <= 60;
    }

    private static String join(String[] fields, int end) {
        StringBuilder value = new StringBuilder();
        for (int i = 0; i < end; i++) {
            if (i > 0) {
                value.append(", ");
            }
            value.append(fields[i]);
        }
        return value.toString().trim();
    }
}
