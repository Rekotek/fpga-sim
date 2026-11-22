// Тест сообщает о неудаче кодом завершения.
module tb_fatal;
    initial begin
        $display("before fatal");
        $fatal(1, "check failed");
    end
endmodule
