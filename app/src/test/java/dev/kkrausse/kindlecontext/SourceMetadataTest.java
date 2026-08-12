package dev.example.kindlecontext;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class SourceMetadataTest {
    @Test
    public void parsesKindleTitleAndInvertedAuthor() {
        SourceMetadata metadata = SourceMetadata.fromKindleDescription(
                "Most recent book. Carnage and Culture: Landmark Battles in the Rise to Western Power, "
                        + "Hanson, Victor Davis, , Book downloaded.Reading is 25% completed., ");

        assertEquals("Carnage and Culture: Landmark Battles in the Rise to Western Power", metadata.title);
        assertEquals("Victor Davis Hanson", metadata.author);
    }

    @Test
    public void parsesKindleTitleAndNormalAuthor() {
        SourceMetadata metadata = SourceMetadata.fromKindleDescription(
                "The Life of Greece, Will Durant, , Book downloaded., ");

        assertEquals("The Life of Greece", metadata.title);
        assertEquals("Will Durant", metadata.author);
    }

    @Test
    public void rejectsUnrelatedDescriptions() {
        SourceMetadata metadata = SourceMetadata.fromKindleDescription("Add bookmark");

        assertEquals("", metadata.title);
        assertEquals("", metadata.author);
    }
}
