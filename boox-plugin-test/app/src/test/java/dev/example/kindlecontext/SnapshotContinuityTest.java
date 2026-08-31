package dev.example.kindlecontext;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SnapshotContinuityTest {
    @Test
    public void overlappingPageSnapshotsAreContinuous() {
        String first = "The opening paragraph introduces a long argument about memory and identity "
                + "before turning toward the consequences of forgetting our shared history.";
        String second = "Memory and identity before turning toward the consequences of forgetting "
                + "our shared history. The next paragraph applies that argument to a family.";

        assertTrue(SnapshotContinuity.overlaps(first, second));
    }

    @Test
    public void overlapIgnoresCaseAndPunctuation() {
        String first = "ONE two three four five six seven eight nine ten eleven twelve thirteen.";
        String second = "One, two three four five six seven eight nine ten eleven twelve! Another page.";

        assertTrue(SnapshotContinuity.overlaps(first, second));
    }

    @Test
    public void containedTransitionalSnapshotIsContinuous() {
        String page = "one two three four five six seven eight nine ten eleven twelve thirteen";
        String transition = "earlier content " + page + " later content from the next visible page";

        assertTrue(SnapshotContinuity.overlaps(page, transition));
    }

    @Test
    public void unrelatedBooksStartANewChain() {
        String first = "The detective walked through the quiet station while rain struck every "
                + "window and the final train disappeared into darkness beyond the platform.";
        String second = "Cellular respiration converts chemical energy through several linked stages "
                + "inside living organisms and supplies fuel needed for ordinary biological work.";

        assertFalse(SnapshotContinuity.overlaps(first, second));
    }

    @Test
    public void shortGenericUiTextCannotJoinBooks() {
        assertFalse(SnapshotContinuity.overlaps(
                "Chapter One Table of Contents Location Menu Search",
                "Chapter One Table of Contents Location Menu Search"));
    }
}
