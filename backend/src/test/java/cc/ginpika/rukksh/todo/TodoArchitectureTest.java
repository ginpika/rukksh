package cc.ginpika.rukksh.todo;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class TodoArchitectureTest {
    @Test void personalWorkDoesNotDependOnAgentExecutionMemoryOrWebIdentity() {
        var classes=new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("cc.ginpika.rukksh.todo");
        noClasses().that().resideInAPackage("cc.ginpika.rukksh.todo..")
                .should().dependOnClassesThat().resideInAnyPackage("cc.ginpika.rukksh.agent..","cc.ginpika.rukksh.ai..","cc.ginpika.rukksh.web..")
                .check(classes);
    }
}
