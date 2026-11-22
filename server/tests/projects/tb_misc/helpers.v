// В одном файле вспомогательный модуль и тестбенч, который его использует: корень — tb_pair.
module tb_gen;
    reg tick = 0;
    always #1 tick = ~tick;
endmodule

module tb_pair;
    tb_gen gen ();
    initial #5 begin
        $display("pair done");
        $finish;
    end
endmodule
