// Файл осциллограммы вне папки запуска сервис не берёт.
module tb_escape;
    reg x = 0;
    initial begin
        $dumpfile("/tmp/escape.vcd");
        $dumpvars(0, tb_escape);
        #1 x = 1;
        #1 $finish;
    end
endmodule
