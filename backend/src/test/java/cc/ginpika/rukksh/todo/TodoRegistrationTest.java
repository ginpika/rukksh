package cc.ginpika.rukksh.todo;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.ClassPathBeanDefinitionScanner;
import org.springframework.context.support.GenericApplicationContext;

/** Domain tests bypass Spring scanning; protect the application's shared bean namespace too. */
class TodoRegistrationTest {
    @Test void personalAndAgentTodosCoexistDuringApplicationComponentScanning() {
        try(var context=new GenericApplicationContext()) {
            var scanner=new ClassPathBeanDefinitionScanner(context);
            scanner.scan("cc.ginpika.rukksh.agent.chat","cc.ginpika.rukksh.agent.runtime","cc.ginpika.rukksh.todo");
            assertEquals(TodoService.class.getName(),context.getBeanDefinition("personalTodoService").getBeanClassName());
            assertEquals(TodoStore.class.getName(),context.getBeanDefinition("personalTodoStore").getBeanClassName());
            assertEquals(cc.ginpika.rukksh.agent.chat.TodoService.class.getName(),context.getBeanDefinition("todoService").getBeanClassName());
            assertNotEquals(TodoStore.class.getName(),context.getBeanDefinition("todoStore").getBeanClassName());
        }
    }
}
